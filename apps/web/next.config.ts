import type { NextConfig } from "next";
import path from "node:path";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Allow dev-resource requests when the app is opened via 127.0.0.1 instead
  // of localhost (Next blocks cross-origin HMR by default).
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    // Monorepo root (two levels up from apps/web). pnpm's hoisted layout puts
    // `next` (and most deps) in the repo-root node_modules, so Turbopack must
    // treat the workspace root — not apps/web — as its boundary to resolve them.
    root: path.join(__dirname, "..", ".."),
  },
};

// Enables `"use workflow"` + `"use step"` directives via the Workflow SDK SWC
// transform. Powers lib/workflows/durable-runtime.ts.
export default withWorkflow(nextConfig);
