# Monorepo (turborepo + pnpm workspaces)

This repo is a **turborepo** containing three apps:

- **`apps/web`** — the Next.js web app (everything that used to live at the repo
  root). All of its guidance lives in `apps/web/AGENTS.md`; paths referenced
  there (`lib/…`, `scripts/…`, `node_modules/next/dist/docs/`, `.env.local`) are
  relative to `apps/web`. Run its dev harness and scripts **from `apps/web`**
  (e.g. `cd apps/web && pnpm dev`, or `pnpm --filter web <script>` from root).
- **`apps/mobile`** — the Expo / React Native app (Stream Chat). See
  `apps/mobile/CLAUDE.md`.
- **`apps/agent`** — the **eve** agent runtime backing the web app's Agents
  section (durable internal AI agents). Deliberately its own workspace
  package: eve needs **AI SDK v7** while apps/web is on v6, so its
  `ai`/`@ai-sdk/*` tree nests under `apps/agent/node_modules` (hoisted
  linker keeps v6 at the root). **Never import apps/web modules that import
  `ai` into agent code.** Shared agent-config schema lives in
  `packages/agent-config` (zod-only; eve snapshots its agent root, so shared
  code must arrive via node_modules, not relative paths). Eve requires
  **Node ≥ 24** (`.nvmrc` pins 24; `nvm use` before dev) and is
  **unconditional** as of 2026-07-20 — `withEve` always applies in
  `apps/web/next.config.ts` (eveRoot `../agent`); the old `EVE_DEV` gate is
  gone. Dev: `nvm use 24 && pnpm dev` — one server; eve routes mount at
  `/eve/v1/*` (middleware-allowlisted; auth = eve channel AuthFn in
  `apps/agent/agent/channels/eve.ts`: Supabase session cookie or
  service-role bearer + `x-hotelclaw-property`/`-agent`/`-user` headers).

Shared code goes under `packages/*` (`@hotelclaw/agent-config` is the first).

## Common commands (run from repo root)

- `pnpm dev` — web dev server (Next.js on :3000, tees to `/tmp/hotelclaw-dev.log`)
- `pnpm dev:mobile` — Expo dev server
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — run across the
  workspace via turbo (filter with `--filter=web` / `--filter=mobile`)

Package manager is **pnpm** with `node-linker=hoisted` (required by Expo/Metro).

---

The full web-app instructions follow:

@apps/web/AGENTS.md
