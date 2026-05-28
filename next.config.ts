import type { NextConfig } from "next";
import path from "node:path";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
};

// Enables `"use workflow"` + `"use step"` directives via the Workflow SDK SWC
// transform. Powers lib/workflows/durable-runtime.ts.
export default withWorkflow(nextConfig);
