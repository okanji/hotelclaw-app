# VERSIONS.md — pinned upstream contracts

The M0 integration test (`tests/gbrain-integration.test.ts`, pending) must
be green before ANY bump of these. No bump without green.

| Component | Version | Source | Notes |
|---|---|---|---|
| eve | 0.24.6 | npm `eve` | apps/agent (AI SDK v7 tree isolated there; see root CLAUDE.md) |
| ai (eve side) | 7.0.31 | npm | apps/agent only — apps/web stays on ai@6 |
| ai (web side) | 6.0.184 | npm | do not collapse the two |
| gbrain | 0.42.65.0 (pinned `1f319e6d5aff7674d8f48f289768ff75911a9ea8`, bumped 2026-07-24) | github:garrytan/gbrain | Pin chosen for `/admin/api/rescope-client` (69bc37f7) — the op that makes REMOTE tenant provisioning possible (see infra/railway-brain-serve/README.md; pin moves in FOUR places in step: serve Dockerfile, brain-maintenance MAINTENANCE_SCRIPT env var, infra maintenance Dockerfile, local `cd ~ && bun add`). Bump gate ran green before AND after (11/11) + scripts/brain-provision-http-test.mjs (13/13). GOTCHA at this version: CLI connectEngine issues dozens of sequential config reads (loadConfigWithEngine alone ~10s from this ~300ms-RTT machine) → `sources list` trips its 10s connect timeout; provisioning no longer depends on the CLI (HTTP transport is primary), and the v2 full-table-prewarm patch in infra/gbrain-local-patches/ (APPLIED 2026-07-25) restores interactive CLI use. Bump gate: `node --env-file=apps/web/.env.local tests/gbrain-integration.test.mjs` must be green. |
| bun | 1.3.14 | npm `bun` | required by gbrain (engines: bun ≥ 1.3.10) |
| Node | 24.18.0 (.nvmrc) | nvm | required by eve |

## Brain repos (git, not npm)

| Repo | Location | Role |
|---|---|---|
| hotelclaw-brain | ~/Desktop/hotelclaw-brains/hotelclaw-brain | SOURCE `master` on the shared server (read-only to pod clients via OAuth scope+source binding) |
| pod-brain-template | ~/Desktop/hotelclaw-brains/pod-brain-template | stamp per client |
| pod-oamar-portfolio-brain | ~/Desktop/hotelclaw-brains/pod-oamar-portfolio-brain | SOURCE `pod-oamar` (pod #1: Kaya, Pinewood) |
| canary-fixture | ~/Desktop/hotelclaw-brains/canary-fixture | permanent read-wall test fixture (own reader client) |

## Shared brain server (fleet v2, 2026-07-18)

ONE `gbrain serve --http` on :3131 — engine = Postgres on the DEDICATED
Supabase project `hotelclaw-brain` (ipyvmotieuooqrefenzu, eu-central-1);
GBRAIN_HOME=~/Desktop/hotelclaw-brains/.gbrain-homes/shared. Connection =
transaction pooler :6543 + GBRAIN_DIRECT_DATABASE_URL → session pooler
:5432 (direct db.<ref> host is IPv6-only; this machine is IPv4-only).
Tenancy = OAuth clients (client_credentials): write bound by --source,
reads by --federated-read; sources MUST be federated (`gbrain sources
federate <id>`) or search silently excludes them. Legacy `gbrain auth
create` tokens are PROHIBITED for tenant principals. Bump gate:
tests/gbrain-integration.test.mjs (11 scoping assertions) green.
Embeddings: LIVE (openai:text-embedding-3-small, 1536 dims, embedded via
`gbrain embed --all` after the docs/embedding-migrations.md column recipe);
OPENAI_API_KEY must be in the serve process env.

LATENCY (root-caused 2026-07-18, worse at 0.42.65): config reads are
per-key round trips (upstream mode.ts documents "ONE round-trip per knob …
a future batch loader can collapse this") — search issues ~68, and as of
0.42.65 CLI STARTUP itself issues dozens (loadConfigWithEngine ~10s from
this ~300ms-RTT machine → `sources list` trips its 10s connect timeout).
LOCAL PATCH on the installed gbrain (src/core/postgres-engine.ts, marked
"HOTELCLAW LOCAL PATCH v2"): **v2 is APPLIED (2026-07-25)** = full-table
prewarm, one round trip per TTL window. Measured effect:
loadConfigWithEngine 10.1s → 0.62s cold / 0.41s warm; `gbrain sources
list` now ~8s (was >10s = timeout), search ~2.5s. (v1, the superseded
per-key memo, fixed repeated reads but NOT cold start.) Disable with
GBRAIN_CONFIG_CACHE_TTL_MS=0. THE PATCH IS LOST ON gbrain REINSTALL/BUMP —
re-apply from infra/gbrain-local-patches/config-cache-v2-block.ts.txt (or
re-check whether upstream shipped the batch loader), then re-run the bump
gate. App provisioning no longer depends on
the CLI (lib/brain/provision.ts is HTTP-first), so the patch only matters
for interactive CLI use + manual ops.

REMOTE PROVISIONING (2026-07-24): per-property tenants (source + fenced
OAuth client) are provisioned OVER HTTP from anywhere — Vercel included:
`sources_add` (MCP, BRAIN_TOKEN_ADMIN) → `/admin/login`
(GBRAIN_ADMIN_BOOTSTRAP_TOKEN, also set on Railway + Vercel) →
`/admin/api/register-client` → `/admin/api/rescope-client`. Code:
apps/web/lib/brain/provision.ts (HTTP-first, CLI fallback); sweep:
apps/web/scripts/provision-property-brain.mjs (HTTP-only now); smoke:
apps/web/scripts/brain-provision-http-test.mjs; app-path integration test:
lib/brain/__tests__/provision-http.integration.test.ts (self-skips
without env).
