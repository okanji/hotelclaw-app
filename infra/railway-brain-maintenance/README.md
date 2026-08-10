# gbrain maintenance cron — Railway `hotelclaw-brain` / `brain-maintenance`

Runs the localOnly gbrain lifecycle ops the serve can't expose over MCP
(gbrain docs, agent-to-gbrain.md Surface 2; "the brain slowly rots"
without them — operational-disciplines.md):

- **hourly** `embed --stale` — new chunks are invisible to vector search
  until embedded (live-sync.md)
- **02:xx UTC** `dream` per source — compiled-truth consolidation
- **09:xx UTC** `doctor` — health heartbeat

## What is actually deployed (2026-07-23)

Created **entirely via the Railway GraphQL API** (the CLI rejects
workspace-scoped tokens for most commands — it calls `me` internally; and
the npm `railway` shim silently exits when its platform binary is missing):

- Service `brain-maintenance` (id `1de8783a-eef0-40cb-9cdd-698f6c8271ce`)
  in project `hotelclaw-brain` (`b0773ff5…`), environment `production`.
- Source: public image `oven/bun:1` — **no repo, no registry, no volume**
  (gbrain's real state lives in the shared Supabase Postgres; config.json
  is generated per run).
- The ENTIRE run script lives in the `MAINTENANCE_SCRIPT` env var;
  `startCommand` = `bash -c "$MAINTENANCE_SCRIPT"`. Update the behavior by
  editing that variable — no image rebuild.
- `cronSchedule: 0 * * * *`, `restartPolicyType: NEVER` (run-to-exit).
- Vars: `GBRAIN_DATABASE_URL` + `OPENAI_API_KEY` (copied from the serve
  service), `MAINTENANCE_SCRIPT`, `ANTHROPIC_API_KEY` (added 2026-08-06 —
  `dream` is LLM work and silently did nothing without it). Optional
  `MAINTENANCE_MODE` (`embed|jobs|extract|reindex|dream|doctor|all`)
  overrides the hour-based auto mode — handy for a manual one-off run via
  `railway redeploy --service brain-maintenance`.

## 2026-08-06 audit — three ops added to MAINTENANCE_SCRIPT (DONE)

The live `MAINTENANCE_SCRIPT` never ran three ops that `gbrain doctor` was
itself asking for. All three are now in the live variable and in
`apps/web/scripts/brain-maintenance.sh`; running them took the doctor from
**65 → 80**. New `auto` schedule: `embed` + `jobs` hourly, `dream` at 02,
`extract` + `reindex` at 03, `doctor` at 09.

1. **`gbrain jobs work`** — nothing ever registered a worker, so an
   `embed-backfill` job submitted 2026-07-18 sat WAITING for **464 hours**.
   Draining it took 3.3s.

   Two gotchas, both found by watching the first real cron run:
   - It is a **daemon** — it does not exit on an empty queue. A bare
     `timeout 600` burned the full 10 minutes every hour doing nothing
     (that run: 21:02:46 → 21:13:23). The script now counts waiting jobs
     first and skips the worker entirely when there are none. Measured
     effect: 10m37s → **41-50s** per idle run, verified over three
     consecutive hours.
   - Count with `grep -cw waiting`, **not** a leading-digit row match: the
     table prints a footer line (`1 jobs shown`) that `^\s+\d+\s` also
     matches, which reports a non-empty queue forever and silently defeats
     the skip.
2. **`gbrain reindex --markdown --yes`** — cleared
   `contextual_retrieval_coverage` (22 pages never evaluated against the CR
   ladder). Bonus: it re-embeds with the ACTIVE model, which collapsed the
   corpus's mixed embedding spaces from 31 stale `zeroentropyai:zembed-1`
   chunks down to 9. Follow with `embed --stale`.
3. **`gbrain extract --stale`** — cleared `links_extraction_lag` (100% of
   pages had un-extracted edges).

   ⚠️ It extracts **0 links** for us, and will keep doing so — see below.
   Kept in the schedule so the sweep is correct the moment that changes.

   **But extraction alone cannot build our graph — our slugs are
   unextractable.** After the 2026-08-06 re-mirror the lag check went green
   and `link_count` stayed at **0**. Root cause is in
   `gbrain/src/core/link-extraction.ts`: both `ENTITY_REF_RE` and
   `WIKILINK_RE` only match links whose target sits in a HARD-CODED
   directory whitelist —

   ```
   people companies meetings concepts deal civic project projects
   source media yc tech finance personal openclaw entities
   ```

   Our namespaces are `documents/`, `operations/`, `guests/`, `suppliers/`.
   **None are on that list**, so even a perfectly cross-linked mirror
   extracts zero edges. Adding `[[documents/<id>]]` links today would be
   wasted work.

   The list is a source-level `const`, not config. BUT it contains
   **`entities`**, and the pattern is `<dir>/<anything>` — so an
   `entities/` prefix is an already-whitelisted escape hatch that keeps our
   own taxonomy. Verified against the real regex:

   ```
   [[suppliers/acme]]           -> ignored
   [[entities/suppliers/acme]]  -> EXTRACTS entities/suppliers/acme
   [[entities/systems/pool]]    -> EXTRACTS entities/systems/pool
   ```

   So earning the graph does NOT need the slug-rename migration an earlier
   draft of this file proposed (`suppliers/`→`companies/` etc.), nor an
   upstream change. It needs: (a) entity pages under `entities/…`, and
   (b) pages that actually LINK to them. (b) is the real work —
   `renderDocumentBrainPage` emits no links at all today.

   **Recommendation: not yet, and understand why before doing it.**
   `link_count=0` is not a defect — it is an accurate measurement that we
   use gbrain as a semantic index over app documents, not as the curated
   cross-linked wiki it is designed to be (see
   `node_modules/gbrain/docs/GBRAIN_RECOMMENDED_SCHEMA.md`: MECE entity
   directories, a RESOLVER decision tree, compiled-truth + timeline pages,
   "unlike RAG, where the LLM re-derives knowledge from scratch every
   query"). Our brain is ~110 auto-mirrored documents against a handful of
   genuinely entity-shaped pages, so a graph would have almost nothing to
   connect. `brain_score 46/100` measures the same gap — it is dominated by
   link density and timeline coverage, both near zero by construction.

   Revisit when entity pages (suppliers, systems, guests, recurring
   incidents) are a meaningful share of the corpus rather than a rounding
   error. Until then the fleet test reports this as a WARN, not a failure,
   deliberately.
2. **No job-queue worker.** Doctor: *"1 embed-backfill job(s) have waited
   on queue 'default' for up to 463h and no live worker is registered"*.
   The script gained a `jobs` mode (`gbrain jobs work --queue default
   --drain`) — wire it to an hourly slot.
3. **No `ANTHROPIC_API_KEY` on this service.** `dream` is compiled-truth
   consolidation and needs an LLM, exactly like the serve's `think` (see
   `infra/railway-brain-serve/README.md`). Copy the key here too, or the
   nightly dream is a no-op and `timeline_coverage` stays at 0.

Each run reinstalls gbrain (`bun add gbrain@github:garrytan/gbrain#1f319e6d5aff7674d8f48f289768ff75911a9ea8`,
~1-2 min). If that cost ever matters, bake the Dockerfile in this
directory into an image instead — it's the same script with the install
done at build time. **Keep the pin in step with the serve deployment.**

## Verify

Railway dashboard → hotelclaw-brain → brain-maintenance → the latest
deployment's logs after any top of the hour:

```
[maintenance] start …
[maintenance] embed --stale
[maintenance] done … hour=HH mode=auto
```

## Files here

- `Dockerfile` + `entrypoint.sh` — the bake-an-image variant (NOT what is
  live; kept as the upgrade path).
- The live config is API-managed; `apps/web/scripts/setup-railway-maintenance.sh`
  documents the from-scratch CLI path for a NON-workspace token.
