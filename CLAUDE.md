# Monorepo (turborepo + pnpm workspaces)

This repo is a **turborepo** containing two apps:

- **`apps/web`** — the Next.js web app (everything that used to live at the repo
  root). All of its guidance lives in `apps/web/AGENTS.md`; paths referenced
  there (`lib/…`, `scripts/…`, `node_modules/next/dist/docs/`, `.env.local`) are
  relative to `apps/web`. Run its dev harness and scripts **from `apps/web`**
  (e.g. `cd apps/web && pnpm dev`, or `pnpm --filter web <script>` from root).
- **`apps/mobile`** — the Expo / React Native app (Stream Chat). See
  `apps/mobile/CLAUDE.md`.

Shared code (when it exists) goes under `packages/*`.

## Common commands (run from repo root)

- `pnpm dev` — web dev server (Next.js on :3000, tees to `/tmp/hotelclaw-dev.log`)
- `pnpm dev:mobile` — Expo dev server
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — run across the
  workspace via turbo (filter with `--filter=web` / `--filter=mobile`)

Package manager is **pnpm** with `node-linker=hoisted` (required by Expo/Metro).

---

The full web-app instructions follow:

@apps/web/AGENTS.md
