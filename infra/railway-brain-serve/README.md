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
- `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` — ≥32 chars `[A-Za-z0-9_-]`; the admin
  API credential. Powers the app's HTTP provisioning
  (`apps/web/lib/brain/provision.ts`: `/admin/login` →
  `/admin/api/register-client` → `/admin/api/rescope-client`). The same
  value must be in Vercel env (Production/Preview) and `.env.local`.
  Without it the serve generates a random token per boot (hidden on
  non-TTY) and the admin surface is effectively unusable.

## Deploy / bump procedure

1. Update the pin in the Dockerfile (and the three mirrors above).
2. Baseline: `node --env-file=apps/web/.env.local --no-network-family-autoselection tests/gbrain-integration.test.mjs`
   must be green BEFORE and AFTER (the VERSIONS.md bump gate — 11 scoping
   assertions against the live serve).
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
