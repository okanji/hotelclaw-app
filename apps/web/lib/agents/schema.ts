// Re-export of the shared agent config schema. The source of truth lives in
// packages/agent-config so the eve runtime (apps/agent) can import the same
// module — eve snapshots only its agent root, so shared code must resolve
// through node_modules, not cross-package relative paths.
export * from "@hotelclaw/agent-config";
