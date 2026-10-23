# VERSIONS.md — pinned upstream contracts

No bump without green: `pnpm typecheck`, `pnpm test`, `pnpm --filter agent
typecheck`, and `cd apps/agent && pnpm build` (eve compile, 0 diagnostics).

| Component | Version | Source | Notes |
|---|---|---|---|
| eve | **0.83.0** (exact pin, upgraded from 0.27.13 on 2026-10-23) | npm `eve` | apps/agent. eve ships a minor every 1–2 days and labels few of them "breaking"; read `node_modules/eve/CHANGELOG.md` + `node_modules/eve/docs/` (they match the installed version) before any bump. The contract this repo codes against is summarised in `apps/web/AGENTS.md` → "eve 0.83 runtime contract". Known cliffs crossed in this upgrade: 0.31 (session ids replace continuation tokens), 0.33 (`defineDynamic` model has no fallback), 0.65 (`ask_question` opt-in), 0.70 (`turn.waiting` holds the turn for input), 0.72 (`evaluate`→`decide`), 0.82 (`limits.sessionUsage`), 0.83 (microsandbox removed). |
| ai (eve side) | ^7.0.150 | npm | apps/agent only — apps/web stays on ai@6 |
| @ai-sdk/anthropic (eve side) | ^4.0.87 | npm | apps/agent; direct provider, `ANTHROPIC_API_KEY` |
| ai (web side) | 6.0.x | npm | do not collapse the two |
| Node | 24.x (.nvmrc) | nvm | required by eve |
| pnpm | 10.2.0 (`packageManager`) | corepack | lockfile v9 — pnpm 8 refuses it (`corepack pnpm@10.2.0 install`) |

## Retired (2026-10-23)

| Component | Replaced by |
|---|---|
| gbrain (Railway `gbrain serve`, pinned 1f319e6d), bun, `BRAIN_MCP_URL`, `BRAIN_TOKEN_*`, `GBRAIN_ADMIN_BOOTSTRAP_TOKEN`, `property_brains` provisioning, the brain repos under `~/Desktop/hotelclaw-brains` | **Property memory** — eve memory slots (`apps/agent/agent/memory/*`) over Postgres (`agent_memories`, migration 0104) via `@hotelclaw/memory`. No external service, no provisioning. Browse at Agents → Memory. |
| `packages/brain`, `infra/railway-brain-*`, `infra/gbrain-local-patches`, `apps/web/lib/brain/*`, brain scripts, `tests/gbrain-*` | deleted |
| `/api/brain/sync-documents` cron + the document→brain mirror | not needed: documents are searched in Postgres directly (`search_documents`) |

The `clients.brain_*`, `property_brains`, and `documents.brain_synced_at`
schema objects remain (no destructive migration); nothing reads them.

## AI UI layer (2026-10-23)

- `ai` 7.0.150, `@ai-sdk/anthropic` 4.0.87, `@ai-sdk/react` 4.0.154 (apps/web and apps/agent share the hoisted tree).
- AI Elements components vendored under `apps/web/components/ai-elements/` (shadcn registry; `streamdown` 2.7.1 + `@streamdown/{cjk,code,math,mermaid}`, `use-stick-to-bottom`).
- Hoisted-pnpm gotcha: after a major bump, delete orphaned nested copies (`apps/web/node_modules/@ai-sdk/*`, `node_modules/ai/node_modules/@ai-sdk/gateway`) — a clean `pnpm install` leaves them and Node resolves them first.
