/**
 * Central AI provider registry.
 *
 * Stage 1 ships this empty: no providers configured, no model calls.
 * Stage 2 adds real models — and that's a single import + entry away:
 *
 *   import { anthropic } from "@ai-sdk/anthropic";
 *   import { openai } from "@ai-sdk/openai";
 *   const REGISTRY = {
 *     "anthropic:claude-sonnet-4-6": anthropic("claude-sonnet-4-6"),
 *     "openai:gpt-4o": openai("gpt-4o"),
 *   };
 */

import type { LanguageModel } from "ai";

export type ModelKey = `${"anthropic" | "openai"}:${string}`;

const REGISTRY: Partial<Record<ModelKey, LanguageModel>> = {
  // intentionally empty in stage 1
};

export function getModel(key: ModelKey): LanguageModel {
  const m = REGISTRY[key];
  if (!m) {
    throw new Error(
      `Model "${key}" not registered. Add it to lib/ai/providers.ts and ensure the provider env var is set.`,
    );
  }
  return m;
}
