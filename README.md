# hotelclaw

A [Turborepo](https://turbo.build/repo) monorepo (pnpm workspaces) containing the
hotelclaw web and mobile apps.

```
.
├── apps/
│   ├── web/      # Next.js web app (the main product)
│   └── mobile/   # Expo / React Native app (Stream Chat — chat & tasks on mobile)
└── packages/     # shared code (added as it's extracted)
```

## Getting started

```bash
pnpm install            # install the whole workspace (pnpm, node-linker=hoisted)
```

### Web (`apps/web`)

```bash
pnpm dev                # Next.js dev server on http://localhost:3000
# or: pnpm --filter web dev   (equivalently: cd apps/web && pnpm dev)
```

### Mobile (`apps/mobile`)

```bash
pnpm dev:mobile         # Expo dev server (use a dev client / native build, not Expo Go)
# or: pnpm --filter mobile dev
```

The Stream Chat Expo SDK ships native code, so the mobile app runs on a **dev
client** (`npx expo run:ios` / `npx expo run:android`), not Expo Go.

## Workspace commands (from the repo root, via turbo)

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `pnpm build`       | build every app                               |
| `pnpm lint`        | lint every app                                |
| `pnpm typecheck`   | typecheck every app                           |
| `pnpm test`        | run tests across the workspace                |

Filter to one app with `--filter=web` or `--filter=mobile`.

Package manager: **pnpm** with `node-linker=hoisted` (required for Expo/Metro to
resolve native modules in a monorepo).
