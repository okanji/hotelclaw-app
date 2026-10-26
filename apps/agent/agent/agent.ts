import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { defineDynamic } from "eve/tools";
import { resolveSessionAgent } from "./lib/agent-config";
import { resolvePodContext } from "./lib/pods";
import { AGENT_TIER_MODELS, type AgentConfig } from "@hotelclaw/agent-config";

/**
 * Resolve a tier to an eve model SELECTION (eve 0.33+: dynamic model handlers
 * return a concrete selection — there is no compiled fallback). The selection
 * object carries per-model settings, which is how a dynamic agent sets
 * reasoning effort and provider options (`defineAgent` siblings are rejected
 * for dynamic models).
 *
 *   - advanced (Opus 5): `reasoning: "medium"` — Opus thinks by default, and
 *     medium keeps turn latency near the Sonnet baseline while buying the
 *     intelligence (sweep low/medium/high against real turns before changing).
 *     The reasoning SUMMARY is kept (display "summarized") so the
 *     chat's turn trace can show it as a collapsed "Thought" row.
 *   - standard (Haiku 4.5): provider defaults — Haiku rejects `effort` and
 *     adaptive thinking, so NOTHING reasoning-related is sent for it.
 *
 * Prompt caching: eve enables Anthropic prompt caching automatically for
 * recognised Anthropic models. A 1-hour TTL is the "cache miss is a bug"
 * lever for channels whose turns arrive minutes apart (the default 5-minute
 * window misses most of them); the extra write cost is paid once per hour,
 * the read discount every turn.
 */
function tierSelection(tier: AgentConfig["modelTier"]) {
  const model = anthropic(AGENT_TIER_MODELS[tier]);
  if (tier !== "advanced") {
    return {
      model,
      modelOptions: { promptCache: { anthropic: { ttl: "1h" as const } } },
    };
  }
  return {
    model,
    reasoning: "medium" as const,
    modelOptions: {
      promptCache: { anthropic: { ttl: "1h" as const } },
      providerOptions: {
        anthropic: {
          // "summarized": the model's reasoning summary reaches the stream
          // as reasoning.* events, which the channel keeps as a "Thought"
          // row in the turn trace (2026-10-26; was "omitted"). Display
          // only — it changes nothing about how the model thinks.
          thinking: { type: "adaptive", display: "summarized" },
        },
      },
    },
  };
}

// Direct provider (no AI Gateway): reads ANTHROPIC_API_KEY from the
// environment, same credential the rest of the app's AI uses. The model is
// resolved per session: pod bot's model_tier, else the custom/virtual agent's
// modelTier, else the standard tier (bare smoke sessions).
export default defineAgent({
  model: defineDynamic({
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
        if (pod?.bot) return tierSelection(pod.bot.modelTier);
        const resolved = await resolveSessionAgent(ctx);
        if (resolved) return tierSelection(resolved.config.modelTier);
        return tierSelection("standard");
      },
    },
  }),
  // Compact earlier than default so long ops conversations stay cheap. eve
  // asks memory providers to capture before compaction and recalls again
  // after, so nothing durable is lost in the summary.
  compaction: { thresholdPercent: 0.8 },
  limits: {
    // Per-session budget (eve 0.82 contract): the window resets when a human
    // approves "Continue" at the prompt eve raises. 2M NEW input tokens (cache
    // reads excluded) or 200k output per window — a runaway session stops and
    // asks before burning real money; a busy channel thread never gets near it.
    sessionUsage: ({ window }) =>
      window.inputTokens - window.cacheReadTokens >= 2_000_000 ||
      window.outputTokens >= 200_000,
    // Idle timeout. Channel threads, assistant tabs and agent chats are
    // revisited for weeks; 30 days (eve's default) matches how long the app
    // keeps them resumable in the UI.
    sessionTimeoutMs: 30 * 24 * 60 * 60 * 1_000,
  },
  experimental: {
    workflow: {
      // Private sessions default to retention 0, which makes a FINISHED
      // session's transcript unreadable the moment it ends. The Assistant and
      // Agents surfaces rebuild their transcripts from the event log, and the
      // fleet Sessions view reads completed job sessions — keep run data for
      // the World's default period.
      retention: "default",
    },
  },
});
