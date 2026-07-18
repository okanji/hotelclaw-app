# VERSIONS.md — pinned upstream contracts

The M0 integration test (`tests/gbrain-integration.test.ts`, pending) must
be green before ANY bump of these. No bump without green.

| Component | Version | Source | Notes |
|---|---|---|---|
| eve | 0.24.6 | npm `eve` | apps/agent (AI SDK v7 tree isolated there; see root CLAUDE.md) |
| ai (eve side) | 7.0.31 | npm | apps/agent only — apps/web stays on ai@6 |
| ai (web side) | 6.0.184 | npm | do not collapse the two |
| gbrain | 0.42.62.0 (INSTALLED, pinned) | github:garrytan/gbrain via `bun install -g` | PGLite engines; per-brain isolation via GBRAIN_HOME (upstream brain-id routing documented but unwired in this version — resolveBrainId has no consumers; FLAGGED as spec/docs discrepancy). OAuth client_credentials auth (`gbrain auth register-client`); master client scope=read only. Embeddings pending (no provider key): query falls back to keyword search. Bump gate: `node --env-file=apps/web/.env.local tests/gbrain-integration.test.mjs` must be green. |
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

LATENCY (root-caused 2026-07-18): search/query ops took ~23s NOT because of
embeddings — the search path issues ~68 uncached per-key `getConfig`
SELECTs (upstream mode.ts documents "ONE round-trip per knob … a future
batch loader can collapse this"), and this machine sits ~300ms RTT from the
eu-central-1 DB. LOCAL PATCH applied to the installed gbrain
(src/core/postgres-engine.ts, marked "HOTELCLAW LOCAL PATCH"): a 30s-TTL
config-read memo (same-process writes update it; disable with
GBRAIN_CONFIG_CACHE_TTL_MS=0). Warm search now ~2s core / ~7s through the
authed MCP surface locally; sub-second expected when the serve is
co-located with the DB (the prod topology). THE PATCH IS LOST ON gbrain
REINSTALL/BUMP — re-check whether upstream shipped the batch loader, else
re-apply, then re-run the bump gate.
