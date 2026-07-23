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
  service), `MAINTENANCE_SCRIPT`. Optional `MAINTENANCE_MODE`
  (`embed|dream|doctor|all`) overrides the hour-based auto mode — handy
  for a manual one-off run via redeploy.

Each run reinstalls gbrain (`bun add gbrain@github:garrytan/gbrain#f72de97`,
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
