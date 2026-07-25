import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scope vitest to pure-logic + targeted integration tests. The rest of
    // the app (React components, Liveblocks integration) has no test
    // infrastructure yet; including the whole tree would surface a flood of
    // false positives on Liveblocks/Tiptap modules that vitest can't load.
    //
    // lib/stream tests hit the real dev Supabase and self-skip without
    // env — run them with:  node --env-file=.env.local node_modules/.bin/vitest run
    include: [
      "lib/spreadsheet/formula/**/*.test.ts",
      "lib/onboarding/**/*.test.ts",
      "lib/brain/**/*.test.ts",
      "lib/agents/__tests__/**/*.test.ts",
      "lib/chat/__tests__/**/*.test.ts",
      "lib/stream/__tests__/**/*.test.ts",
      "lib/documents/__tests__/**/*.test.ts",
    ],
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
      // `server-only` throws outside an RSC graph; tests run in plain node.
      "server-only": new URL("./lib/test/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
});
