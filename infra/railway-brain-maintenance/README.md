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

   ⚠️ For its first three days this extracted **0 links** — see below for
   why, and for the 2026-08-10 build that fixed it (first real edges wired
   the same day).

   **Extraction alone could not build our graph — our slugs were
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

   ~~The recommendation used to be "do neither yet".~~ **BUILT 2026-08-10**
   — the graph layer is implemented and verified live:

   - **Slug conventions carry the graph.** Probed against the live serve:
     `companies/x` → type `company`, `people/x` → `person`; everything else
     (`entities/`, `systems/`, `suppliers/`, explicit `type:` param) falls
     back to `concept`. So captures now file suppliers under `companies/`,
     people under `people/`, systems/topics under `concepts/` (extractable
     for links even though only the first two count in the coverage
     denominators). Enforced via the `brain_capture` schema + description +
     KNOWLEDGE_DISCIPLINE in `packages/brain`; the three deterministic
     writers moved too (`meetings/outcomes`, `concepts/triage-routing`,
     `concepts/workflow-signals`). Legacy pages migrated with timelines.
   - **The doc mirror now emits links.** `matchRelatedEntities` in
     `packages/brain` (deterministic title match, word-bounded, no model)
     picks entity pages the document mentions; `renderDocumentBrainPage`
     renders them as a `## Related` section of `[Title](slug)` links — the
     exact shape the extractor matches. `doc-sync` feeds it with a per-
     property entity list (60s cache, fail-soft).
   - **Verified end to end at Solana Cove:** captured
     `concepts/walk-in-freezer` → 3 mentioning documents re-mirrored with
     Related sections → `extract --stale` wired **3 links** (the brain's
     first ever) → `get_backlinks` shows `documents/* → concepts/walk-in-
     freezer (mentions)` → brain_score 46 → 49 with all three frozen
     components moving (link_density 0→1, no_orphans 0→1, timeline 0→2).

   The score now climbs with corpus growth: captures create typed entities,
   mirrors link to them, the 03:00 extract wires edges, and timelines
   accrue from meetings + captures.

   **Link lag is CLOSED (2026-08-10):** `reconcileEntityMentionCursors`
   runs as pass 0 of the nightly `/api/brain/sync-documents` cron — any
   entity newer than a mentioning document's mirror resets that document's
   cursor, so the same run re-renders its Related links. Without it, a
   stable SOP mirrored before an entity existed would never link to it
   (edits were the only re-render trigger, and reference docs rarely get
   edited). Verified live: created `concepts/south-lawn`, touched nothing,
   ran the cron → 7/7 mentioning documents re-mirrored WITH the link two
   minutes later; extract wired 7 edges; brain_score 49 → 50. Self-limiting:
   after the re-mirror, `brain_synced_at > entity.updated` and the doc
   stops matching, so it costs one re-mirror per (entity-update, doc) pair.

   Remaining honest caveat: the 15 timeline-coverage points count only
   `companies/`/`people/` pages accruing evidence — earned by real usage,
   not ops. (It largely self-resolves: pages born from `captureEvidence`
   carry a timeline entry by construction, so the ratio tracks ~1.0 once
   real supplier/person captures exist. Note gbrain's health denominators
   include SOFT-DELETED entity pages until their 72h TTL purges them —
   deleted test probes can depress the ratio for up to three days.)

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
