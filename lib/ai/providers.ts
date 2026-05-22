/**
 * Central AI provider registry.
 *
 * Adding a new model = one entry in REGISTRY_FACTORIES + the matching env
 * var. Callers ask for a `ModelKey` and get back a `LanguageModel`; nothing
 * else in the app needs to know which provider sits behind the key.
 *
 * Env vars (server-only):
 *   XAI_API_KEY — Grok (grok-4, grok-3-mini, etc.). Required for meeting
 *     summarization in `lib/meetings/summarize.ts`.
 */

import "server-only";
import type { LanguageModel } from "ai";
import { createXai } from "@ai-sdk/xai";

export type ModelKey = `xai:${string}`;

// Lazy singleton. Instantiating the provider eagerly at module load would
// throw in environments that don't have XAI_API_KEY set (e.g. CI builds,
// build-time SSG passes). Defer to first use so unrelated routes stay green.
let _xai: ReturnType<typeof createXai> | null = null;
function xai() {
  if (_xai) return _xai;
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "XAI_API_KEY is not set. Add it to .env.local to use Grok.",
    );
  }
  _xai = createXai({ apiKey });
  return _xai;
}

const REGISTRY_FACTORIES: Record<ModelKey, () => LanguageModel> = {
  // Default meeting-summary model. `grok-4-fast-non-reasoning-latest` is
  // the fast, low-latency variant — no chain-of-thought, ~half the cost of
  // grok-4, and supports tool calls (which the Vercel AI SDK uses under
  // the hood for `generateObject`).
  "xai:grok-4-fast-non-reasoning-latest": () =>
    xai()("grok-4-fast-non-reasoning-latest"),
};

export function getModel(key: ModelKey): LanguageModel {
  const factory = REGISTRY_FACTORIES[key];
  if (!factory) {
    throw new Error(
      `Model "${key}" not registered. Add it to lib/ai/providers.ts and ensure the provider env var is set.`,
    );
  }
  return factory();
}
