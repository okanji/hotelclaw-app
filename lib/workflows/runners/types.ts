import "server-only";
import type { RunnerContext } from "@/lib/workflows/catalog/types";

// Runners share the catalog's RunnerContext type — this re-export plus a
// generic-typed signature keeps the per-surface runner files readable.

export type RunnerCtx = RunnerContext;

export type RunnerImpl<TConfig, TOutput> = (args: {
  config: TConfig;
  ctx: RunnerCtx;
}) => Promise<TOutput>;
