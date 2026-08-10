# Railway: hotelclaw-brain (the gbrain serve)

The SHARED knowledge-brain server — one `gbrain serve --http`, many
per-property/per-pod sources, tenancy = source-fenced OAuth clients.
Project `hotelclaw-brain`, service `hotelclaw-brain`,
`https://hotelclaw-brain-production.up.railway.app` (MCP at `/mcp`).

This directory is the CANONICAL deploy config (the original 2026-07-20
deploy ran from a session scratchpad that no longer exists — do not lose
these files again).

## Topology

- Image: `oven/bun:1` + `bun add gbrain@github:garrytan/gbrain#<PIN>`.
  **The pin lives in the Dockerfile RUN line** and must move in step with:
  1. `VERSIONS.md` (repo root)
  2. the `MAINTENANCE_SCRIPT` env var on the `brain-maintenance` cron
     service (it `bun add`s the same pin every run)
  3. `infra/railway-brain-maintenance/Dockerfile` (the not-live image
     variant of the cron)
  4. the local CLI install (`cd ~ && bun add gbrain@github:garrytan/gbrain#<PIN>`)
- Volume `hotelclaw-brain-volume` at `/data` (GBRAIN_HOME). Railway volumes
  are single-service; nothing else can mount it. All real state (sources,
  pages, OAuth clients) is in the dedicated Supabase Postgres
  (`ipyvmotieuooqrefenzu`, eu-central-1) — the volume only holds the
  generated config + locks, so a wiped volume is a non-event.
- `entrypoint.sh` writes `.gbrain/config.json` from env ON FIRST BOOT only
  (volume-persisted after). To change config: `railway ssh -s
  hotelclaw-brain -- rm /data/.gbrain/config.json` then redeploy, or edit
  in place.

## Env vars (service `hotelclaw-brain`)

- `GBRAIN_DATABASE_URL` — Supabase transaction pooler (:6543)
- `GBRAIN_HOME=/data`
- `GBRAIN_PUBLIC_URL=https://hotelclaw-brain-production.up.railway.app`
- `OPENAI_API_KEY` — embeddings (text-embedding-3-small)
- `ANTHROPIC_API_KEY` — **MISSING AS OF 2026-08-06; `think` is dead without
  it.** gbrain's synthesis half ("search gives you raw pages, gbrain gives
  you the answer") needs an LLM on the SERVE. Without the key, `think`
  gathers pages and returns
  `{"answer":"(no LLM available — set ANTHROPIC_API_KEY or pass client)",
  "synthesisOk":false,"warnings":["NO_ANTHROPIC_API_KEY"]}` after ~20s —
  a silent capability outage, since `brain_think` is advertised to every
  bot as "synthesized answer with citations and gap analysis". The nightly
  `dream` cycle (compiled-truth consolidation) depends on the same key.
  Fix: set it on BOTH this service and `brain-maintenance`, then
  `tests/gbrain-fleet.test.mjs` check 5b goes green.
- `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` — ≥32 chars `[A-Za-z0-9_-]`; the admin
  API credential. Powers the app's HTTP provisioning
  (`apps/web/lib/brain/provision.ts`: `/admin/login` →
  `/admin/api/register-client` → `/admin/api/rescope-client`). The same
  value must be in Vercel env (Production/Preview) and `.env.local`.
  Without it the serve generates a random token per boot (hidden on
  non-TTY) and the admin surface is effectively unusable.

## Deploy / bump procedure

1. Update the pin in the Dockerfile (and the three mirrors above).
2. Baseline: BOTH test files must be green BEFORE and AFTER —
   `node --env-file=apps/web/.env.local --no-network-family-autoselection tests/gbrain-integration.test.mjs`
   (the VERSIONS.md bump gate — 11 scoping assertions against the permanent
   master/pod/canary fixtures) and
   `node --env-file=apps/web/.env.local --no-network-family-autoselection tests/gbrain-fleet.test.mjs`
   (the REAL per-property fleet — see "Why two tests" below).
3. From a dir linked to the project/service (`railway link --project
   hotelclaw-brain --service hotelclaw-brain` — needs Dockerfile +
   entrypoint.sh present, copy from here):
   `railway up --detach`
   The changed RUN line busts the layer cache; no NO_CACHE needed.
4. Health: `curl https://hotelclaw-brain-production.up.railway.app/health`
   → check `version` moved.
5. Re-run the integration test (step 2) + `node scripts/…` smoke tests that
   touch the brain (`brain-doc-sync-test.mjs`).

The Railway CLI: the pnpm shim is broken (missing platform binary); use a
real binary (v5.28+). `railway ssh -s hotelclaw-brain -- <cmd>` runs
one-off commands in the live container (has the gbrain CLI + /data home).

## Search latency + retrieval quality (measured 2026-08-06)

> Latency was FIXED by the region move documented below — search is now
> ~2-3.7s, not ~21s. The analysis is kept because it is how the region
> problem was found, and because the round-trip-count characterisation still
> governs any future latency work.

**Why a brain search cost a bot turn ~21s.** It was not one slow step. Every
primitive is fast — measured directly against this serve's Postgres:

| step | time |
|---|---|
| `connect()` | 1.25s |
| `createEngine()` | 0.02s |
| `embedQuery()` (OpenAI) | 0.5s |
| `engine.searchVector()` | 1.3s |
| `engine.searchKeyword()` | 1.0s |
| **full `query` op, local CLI** | **~12s** |
| **full `search` op, via this serve** | **~21s** |

So ~4s is real work and the rest is gbrain's orchestration: mode/config
resolution plus the post-fusion stages (backlink counts, salience scores,
effective dates, recency decay, alias resolution, graph signals, content-flag
stamping), each its own sequential round trip to a pooled Postgres in
eu-central-1. Dozens of small round trips, not one slow query.

### FIXED 2026-08-06 — the serve was in the wrong region

The serve ran in **sfo** (Railway's default, never set explicitly) while its
Postgres is in **eu-central-1**. Every one of those dozens of round trips paid
a transatlantic RTT. Isolating it beforehand: `/health` (no DB) answered in
~0.75s, `get_stats` (one DB query) in ~1.03s → ~300ms per serve→DB round trip.

```
railway service scale --service hotelclaw-brain eu-west=1 sfo=0
```

Note the region id is **`sfo`**, not `us-west`; and scaling in one region does
NOT remove the other — the first call left `EU West (1) · sfo (1)` at two
replicas, which a single-region volume cannot serve. Pass both, as above.
The volume survived the move and the entrypoint's `config.json` was preserved.

**Measured, same client, same queries:**

| op | sfo | eu-west |
|---|---|---|
| `search` | ~21,000ms | **1,813 – 3,670ms** |
| `get_page` | 4,893ms | 1,010ms |
| `list_pages` | 1,651ms | 355ms |
| `/health` | ~750ms | 515ms |

Fleet-test check `6b` ("search comfortably fast (<10s)") went from WARN to
PASS. This is the single change that made brain search cheap enough to sit in
a bot turn.

Remaining hop: the Vercel app has no `regions` in `apps/web/vercel.json`, so
it runs US-East and pays ~90ms per brain call reaching EU. That is one round
trip against the dozens the serve makes, so it was correctly not the priority
— revisit only if brain latency matters again.

Ruled out by measurement, so don't re-chase them: multi-query expansion
(`--expand false` changes nothing), prepared statements (`GBRAIN_PREPARE=true`
is within noise — 11.8s→11.7s, 12.4s→12.5s; an early 25s→11.5s reading was
cold-start noise), embedding-provider availability (`diagnoseEmbedding()`
returns ok, `embedQuery` takes 0.5s), and result caching (repeating the same
query is not faster).

### Retrieval quality — was broken, FIXED by `reindex` (read this before blaming upstream)

Mid-audit, semantic search looked dead: `engine.searchVector` alone ranked the
walk-in freezer SOP first (0.3522 for "what happens when the chiller gets too
warm", matching a raw pgvector query) while the fused `search`/`query` op
returned unrelated pages — Brand Voice Guide, Lost & Found, Fire Evacuation.
The obvious read was "gbrain's fusion discards the vector arm". **That was
wrong.** The cause was OUR corpus state, and `gbrain reindex --markdown`
(run for an unrelated doctor warning) fixed it:

- 22 pages had never been evaluated against the **contextual-retrieval
  ladder**, so they scored degenerately in the fused path — the exact pages
  that kept surfacing.
- Chunks were split across **two embedding models** after a provider switch
  (31 × `zeroentropyai:zembed-1` vs `openai:text-embedding-3-small`). The
  vector SQL does not filter by model, so those cosine distances were
  computed across incompatible embedding spaces. Reindex re-embedded with the
  active model, 31 → 9.

Verified after the fix — "chiller" appears nowhere in the freezer SOP:

| query | top hits |
|---|---|
| "what happens when the chiller gets too warm" | Seaside Spa SOP, **Walk-in Freezer SOP**, Salt-Air Runbook |
| "how cold should we keep frozen goods" | Summer Menu Post-Mortem, **Walk-in Freezer SOP** |
| "what do we do if a guest complains about their room" | Room Turn Standards, **Guest Recovery Playbook** |

`search` is genuinely hybrid. Ranking is imperfect — the right document is
often rank 2 rather than 1 — so bots should scan the top few rather than
trust rank 1, which is what `brainToolDescriptions.brain_search` now says.

**If semantic recall ever looks dead again, check corpus health FIRST**:
`select model, count(*) from content_chunks group by 1` should return ONE
row, and doctor's `contextual_retrieval_coverage` should be clean. Both are
now maintained hourly by the `reindex` slot in the maintenance cron.
- Chunk embeddings are healthy: 125/125 present, all 1536-dim. The corpus had
  TWO embedding spaces mixed — 31 chunks carried `model =
  zeroentropyai:zembed-1` from the 2026-07-18→23 era before the switch to
  `openai:text-embedding-3-small`, and the vector SQL does not filter by model.
  `gbrain reindex --markdown --yes` (now hourly-scheduled at 03 UTC, see the
  maintenance README) re-embedded with the active model and brought that down
  to **9**, all on pages whose chunker version was already current.

Fleet-test check `5a2` guards this end-to-end: search a page's own title and
require that page back.

## Why two tests

`tests/gbrain-integration.test.mjs` asserts SCOPING against three permanent
fixtures (sources `master` / `pod-oamar` / `canary-fixture`, credentials
from env refs). It is a contract test with upstream and it must never
regress — but fixtures are not the fleet.

`tests/gbrain-fleet.test.mjs` asserts the state of the ACTUAL bindings in
`property_brains` — the path most properties use. The 2026-08-06 audit
introduced it because the fixture gate was green while:

- one property's OAuth client had been **revoked** server-side
  (`invalid_grant / Client has been revoked`), and the Brain section still
  rendered "Provisioned · Online" over an empty knowledge map — a dead
  binding was indistinguishable from a fresh one;
- 13 mirror pages pointed at **deleted or archived documents**, so bots
  could cite retracted content as current knowledge (the cursor sweep is
  document-driven and structurally cannot see these — hence
  `sweepOrphanedBrainPages`, now a second pass in the nightly cron);
- 63 of 84 mirror pages carried **slug-derived titles**
  ("E536b30a C4ff 4733 …") from before the serve read the body H1, which
  the cursor calls "fresh" forever (hence
  `apps/web/scripts/brain-remirror-documents.mjs --stale-titles`);
- `think` returned a **placeholder instead of an answer** (no
  `ANTHROPIC_API_KEY`, see the env list above).

Run both. The fleet test exits non-zero on real defects and prints WARN
lines for degradation that is not yet an outage (search latency, an
unhealthy doctor score, un-extracted graph edges).
