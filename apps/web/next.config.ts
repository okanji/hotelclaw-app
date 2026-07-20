import type { NextConfig } from "next";
import path from "node:path";
import { withWorkflow } from "workflow/next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // Allow dev-resource requests when the app is opened via 127.0.0.1 instead
  // of localhost (Next blocks cross-origin HMR by default).
  allowedDevOrigins: ["127.0.0.1"],
  // Workspace packages shipped as TS source (shared with the eve runtime).
  transpilePackages: ["@hotelclaw/agent-config", "@hotelclaw/chat-ui"],
  turbopack: {
    // Monorepo root (two levels up from apps/web). pnpm's hoisted layout puts
    // `next` (and most deps) in the repo-root node_modules, so Turbopack must
    // treat the workspace root — not apps/web — as its boundary to resolve them.
    root: path.join(__dirname, "..", ".."),
  },
};

// Enables `"use workflow"` + `"use step"` directives via the Workflow SDK SWC
// transform. Powers lib/workflows/durable-runtime.ts.
const config = withWorkflow(nextConfig);

// The eve agent runtime lives in apps/agent (its own workspace package, so its
// AI SDK v7 dependency tree nests separately from this app's v6 under the
// hoisted linker; `eve` itself resolves from the hoisted root node_modules).
// Eve is UNCONDITIONAL infrastructure (2026-07-20): the default channel bot and
// custom channel deployments run on it with no fallback, so the whole
// toolchain requires Node >= 24 (.nvmrc / engines pin it). The old EVE_DEV
// gate caused two silent-absence outages (turbo strict env stripped it in dev
// and in the Vercel build) and is gone.
export default withEve(config, { eveRoot: "../agent" });
