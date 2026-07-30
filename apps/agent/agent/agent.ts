import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { defineDynamic } from "eve/tools";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { resolveSessionAgent } from "./lib/agent-config";
import { resolvePodContext } from "./lib/pods";
import { AGENT_TIER_MODELS, type AgentConfig } from "@hotelclaw/agent-config";

/**
 * Per-call settings for the advanced tier. eve owns the generateText call, so
 * providerOptions can't be passed at the call site — bake them into the model
 * with the AI SDK's settings middleware instead.
 *
 * `effort: "medium"` is the point of the exercise: Opus 5 thinks by default,
 * which alone would make every turn slower than the Sonnet 4.6 it replaced.
 * Medium keeps turn latency near the old baseline while still buying the
 * intelligence (sweep low/medium/high against real turns before changing it).
 */
const ADVANCED_SETTINGS = defaultSettingsMiddleware({
  settings: {
    providerOptions: {
      anthropic: {
        effort: "medium",
        // Explicit rather than implicit: adaptive is Opus 5's default, and
        // "omitted" keeps the model's reasoning out of the transcript (the
        // chat's progress line reports tool activity instead).
        thinking: { type: "adaptive", display: "omitted" },
      },
    },
  },
});

/**
 * Resolve a tier to a model. ONLY the advanced tier gets ADVANCED_SETTINGS:
 * `effort` and adaptive thinking are rejected by Haiku 4.5, so applying them
 * to the standard tier would 400 every standard-tier session.
 */
function tierModel(tier: AgentConfig["modelTier"]) {
  const model = anthropic(AGENT_TIER_MODELS[tier]);
  if (tier !== "advanced") return model;
  return wrapLanguageModel({ model, middleware: ADVANCED_SETTINGS });
}

// Direct provider (no AI Gateway): reads ANTHROPIC_API_KEY from the
// environment, same credential the rest of the app's AI uses. The model is
// resolved per session: pod bot's model_tier, else the custom agent's
// modelTier, else the fallback.
export default defineAgent({
  model: defineDynamic({
    fallback: anthropic("claude-haiku-4-5-20251001"),
    events: {
      // step.started, NOT session.started: session-scoped model selections
      // must be serializable strings on the Vercel workflow backend — a
      // provider object here is rejected at runtime ("must be serializable
      // ... or use step.started") and EVERY session silently fell back to
      // Haiku in prod. Step scope accepts provider objects; we return the
      // same model every step, so there's no mid-session model switching
      // and prompt caching is unaffected.
      "step.started": async (_event, ctx) => {
        const pod = await resolvePodContext(ctx);
        if (pod?.bot) return tierModel(pod.bot.modelTier);
        const resolved = await resolveSessionAgent(ctx);
        if (resolved) return tierModel(resolved.config.modelTier);
        return null;
      },
    },
  }),
  // Compact earlier than default so long ops conversations stay cheap.
  compaction: { thresholdPercent: 0.8 },
  // Dev-tier session budgets (fleet spec M2): a runaway session stops and
  // asks before burning real money. Raise for production deliberately.
  limits: {
    maxInputTokensPerSession: 2_000_000,
    maxOutputTokensPerSession: 200_000,
  },
});
