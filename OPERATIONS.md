# OPERATIONS.md — fleet backups, DR, and security posture

Companion to `VERSIONS.md`. Fleet spec M6.4/M6.5. Living document — update
when facts change.

## Backups & disaster recovery

| Asset | Truth | Backup | Rebuild |
|---|---|---|---|
| Brain repos (`~/Desktop/hotelclaw-brains/*`) | git | **TODO: push each to a private GitHub remote** (`hotelclaw-brain`, `pod-brain-template`, `pod-<slug>-brain`) | clone → `gbrain import` → `embed --all` → `sync` |
| Brain index (gbrain DB) | derived | none needed — rebuildable from the repo | `gbrain sync` + `gbrain embed --all` |
| Supabase (app + tenancy spine) | Postgres | Supabase PITR — **TODO: confirm PITR enabled on the project** | Supabase dashboard restore |
| eve durable sessions (dev) | `.eve/.workflow-data` | none (dev-only; prod = Vercel Workflows) | sessions are disposable in dev |
| Secrets (`.env.local`, `BRAIN_TOKEN_*`) | env | operator password manager | re-mint (see rotation) |

**Start commands** (dev; each is a long-running process):

```bash
# App + eve runtime
nvm use 24 && EVE_DEV=1 pnpm dev
# Brain endpoints (from each brain repo dir; PATH needs ~/.bun/bin)
cd ~/Desktop/hotelclaw-brains/hotelclaw-brain && \
  GBRAIN_HOME=~/Desktop/hotelclaw-brains/.gbrain-homes/master gbrain serve --http --port 7101
cd ~/Desktop/hotelclaw-brains/pod-oamar-portfolio-brain && \
  GBRAIN_HOME=~/Desktop/hotelclaw-brains/.gbrain-homes/pod-oamar-portfolio gbrain serve --http --port 7102
```

**gbrain runtime model (v2, shared Postgres serve — superseded the v1
per-brain PGLite processes):** ONE `gbrain serve --http` on :3131,
GBRAIN_HOME=.gbrain-homes/shared, Postgres on the dedicated Supabase brain
project. Postgres removed the PGLite single-writer limits (CLI ops and the
dream cycle can run alongside serve). Embeddings are LIVE
(openai:text-embedding-3-small 1536d; `embedding_model`/`embedding_dimensions`
are FILE-plane fields in the GBRAIN_HOME config.json — `gbrain config set`
of those keys is a silent no-op — and OPENAI_API_KEY must be in the serve
env). Dimension changes follow docs/embedding-migrations.md (drop BOTH
hnsw indexes incl. the facts halfvec one, NULL embeddings, ALTER, re-embed).

**Latency (root-caused 2026-07-18):** search/query ops cost ~68 per-key
`getConfig` SELECTs; against a cross-region DB that is ~20s per call.
Locally patched with a 30s-TTL config memo in the installed gbrain
(see VERSIONS.md — patch is lost on reinstall). PROD REQUIREMENT: deploy
the serve co-located with the brain DB region (eu-central-1) — the config
chattiness then costs milliseconds.

**Rebuild drill** (run once when gbrain endpoints exist, then annually):
kill the pod brain index → re-clone repo → import/embed/sync →
`tests/gbrain-integration.test.ts` green → `gbrain query "pool green
recovery"` returns the seeded procedure with citations.

## Secret rotation

- **Supabase service key**: rotate in dashboard → update `.env.local` +
  deploy env. Everything (eve channel bearer, glue, scripts) reads env.
- **Brain tokens** (`BRAIN_TOKEN_POD_*`): `gbrain auth revoke` + `gbrain
  auth create` → update env var named by `clients.brain_token_ref`. Rows
  never hold tokens.
- **Actions-MCP keys** (`api_tokens`): revoke by setting `revoked_at`;
  re-mint via `scripts/onboard-client.mjs` pattern. Hashes only at rest.

## Security posture (current state + prod blockers)

Fail-closed properties verified in dev drills:
- Tenancy: eve channel auth verifies Supabase session/service bearer +
  membership; every tool query filters by the session's verified property.
- `bots.tool_set` allow-lists (bot without a tool: the tool doesn't exist).
- `api_tokens.allowed_tools` allow-lists on the actions MCP (legacy keys
  get nothing); token→property binding = tenant isolation (drill-proven).
- Money paths (`refund_booking`, `override_rate`, `comp_night`) gated
  `approval: always()`; injection drill passed (hostile task text = data).
- eve default-harness shell/file tools disabled (`disableTool()`).
- Brain URL/token never in prompts/history; token refs constrained to
  `BRAIN_TOKEN_*` env names.

**Prod blockers — do NOT deploy the fleet before these:**
1. Remove `localDev()` from `apps/agent/agent/channels/eve.ts` auth chain.
2. Re-verify approval-park durability on the production workflow world
   (known dev-world limitation: parks don't survive dev-server restart).
3. Verify eve + app `withWorkflow` route coexistence in a Vercel preview.
4. Node 24 runtime configured on Vercel.
5. `/api/dev/pod-bot-test` is prod-404 (already coded) — confirm in build.
6. CI: run `pnpm typecheck`, RLS + pod-bot + actions-MCP drills, and (once
   gbrain lands) `tests/gbrain-integration.test.ts` on every `eve`/`gbrain`
   bump (VERSIONS.md contract — no bump without green).

## Legal (before first external contract — operator + counsel)

- Processor/controller terms (Kenya DPA 2019; GDPR-adjacent guests).
- Data residency answer (Supabase region + Anthropic processing).
- Offboarding data clause: snapshot handover + deletion timelines
  (mechanics: `scripts/offboard-client.mjs`).
