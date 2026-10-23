# OPERATIONS.md — fleet backups, DR, and security posture

Companion to `VERSIONS.md`. Fleet spec M6.4/M6.5. Living document — update
when facts change.

## Backups & disaster recovery

| Asset | Truth | Backup | Rebuild |
|---|---|---|---|
| Property memory (`agent_memories`) | Postgres (app Supabase project) | covered by Supabase PITR with the rest of the app | restore with the app |
| Supabase (app + tenancy spine) | Postgres | Supabase PITR — **TODO: confirm PITR enabled on the project** | Supabase dashboard restore |
| eve durable sessions (dev) | `.eve/.workflow-data` | none (dev-only; prod = Vercel Workflows) | sessions are disposable in dev |
| Secrets (`.env.local`) | env | operator password manager | re-mint (see rotation) |

**Start commands** (dev):

```bash
# App + eve runtime (eve is unconditional — no flag; eve 0.83 since 2026-10-23)
nvm use 24 && pnpm dev
```

There is no separate brain process any more: property memory is rows in the
app's Postgres (`agent_memories`, migration 0104), recalled by the eve memory
slots in `apps/agent/agent/memory/*`. The gbrain serve, its Railway
deployment, the maintenance cron, and the per-brain PGLite/Postgres homes are
retired (see VERSIONS.md → Retired).

## Secret rotation

- **Supabase service key**: rotate in dashboard → update `.env.local` +
  deploy env. Everything (eve channel bearer, glue, scripts) reads env.
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
- eve default-harness shell/file tools disabled (`disableTool()`); the
  opt-in `ask_question`/`no_reply`/`sleep` are authored; `web_fetch` and
  provider `web_search` are on.
- Memory scope is locked per turn from verified auth attributes (eve memory
  slots); guests never get memory tools (prefetch + deterministic capture only).

**Prod blockers — do NOT deploy the fleet before these:**
1. Remove `localDev()` from `apps/agent/agent/channels/eve.ts` auth chain.
2. Re-verify approval-park durability on the production workflow world
   (known dev-world limitation: parks don't survive dev-server restart).
3. Verify eve + app `withWorkflow` route coexistence in a Vercel preview.
4. Node 24 runtime configured on Vercel.
5. `/api/dev/pod-bot-test` is prod-404 (already coded) — confirm in build.
6. CI: run `pnpm typecheck`, `pnpm test`, `pnpm --filter agent typecheck`,
   `cd apps/agent && pnpm build`, and the RLS + pod-bot + actions-MCP drills
   on every `eve` bump (VERSIONS.md contract — no bump without green).
7. Apply migration 0104 (`agent_memories`) before deploying the eve 0.83
   build — the memory slots fail recall (and therefore the turn) if the table
   is missing.

## Legal (before first external contract — operator + counsel)

- Processor/controller terms (Kenya DPA 2019; GDPR-adjacent guests).
- Data residency answer (Supabase region + Anthropic processing).
- Offboarding data clause: snapshot handover + deletion timelines
  (mechanics: `scripts/offboard-client.mjs`).
