import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scope vitest to pure-logic tests only. The rest of the app
    // (React components, Liveblocks integration, Supabase) has no test
    // infrastructure yet; including the whole tree would surface a flood of
    // false positives on Liveblocks/Tiptap modules that vitest can't load.
    include: [
      "lib/spreadsheet/formula/**/*.test.ts",
      "lib/onboarding/**/*.test.ts",
    ],
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
});
