import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { defineDynamic } from "eve/tools";
import { resolveSessionAgent } from "./lib/agent-config";
import { resolvePodContext } from "./lib/pods";
import { AGENT_TIER_MODELS } from "@hotelclaw/agent-config";

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
        if (pod?.bot) return anthropic(AGENT_TIER_MODELS[pod.bot.modelTier]);
        const resolved = await resolveSessionAgent(ctx);
        if (resolved) return anthropic(AGENT_TIER_MODELS[resolved.config.modelTier]);
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
