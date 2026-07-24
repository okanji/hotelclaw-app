# Local patches to the INSTALLED gbrain (lost on every bump — re-apply)

## config-cache (2026-07-18, VERSIONS.md "HOTELCLAW LOCAL PATCH")

`~/node_modules/gbrain/src/core/postgres-engine.ts` — a 30s-TTL memo over
config reads. Upstream's search path issues ~68 per-key `getConfig`
SELECTs per search; from this machine (~300ms RTT to eu-central-1) that is
~20s per search. The memo restores ~2s. Same-process writes update the
cache; disable with `GBRAIN_CONFIG_CACHE_TTL_MS=0`.

Applies to the LOCAL CLI install only. The Railway serve runs vanilla
upstream (it never had the patch; sfo→eu-central RTT is smaller and prod
has lived with it — check `docs/` upstream for a batch loader before
re-applying, and drop the patch when upstream ships one).

**Re-apply after `bun add gbrain@…` in `~`:**
1. Open `~/node_modules/gbrain/src/core/postgres-engine.ts`, find the
   upstream `getConfig` / `setConfig` / `unsetConfig` methods.
2. Replace them with the block in `config-cache-block.ts.txt` (the comment
   + `_configCache` + `_configCacheTtlMs` fields + the three methods),
   adapting if upstream's method bodies changed (keep upstream's retry
   wrapper — the patch only adds the Map lookups/updates).
3. Verify: a repeated `gbrain search` from the CLI should be fast (~2s)
   on the second run.
