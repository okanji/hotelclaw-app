import "server-only";
/**
 * Bot runtime — the common machinery every in-app AI bot uses.
 *
 * Tier 1 of our two-tier AI architecture (see AGENTS.md). Each in-app bot
 * (channel bot, task bot, doc bot, calendar bot, etc.) delegates its
 * inner generation step to this function. Surface-specific concerns
 * (Stream lock/coalesce, typing indicators, Liveblocks thread targeting)
 * stay in the caller; the model call, prompt assembly, and shared-tool
 * wiring live here.
 *
 * Three things this runtime guarantees uniformly across bots:
 *   1. The system prompt always tells the model WHY it's responding
 *      (activation reason), to break in-context deferral patterns.
 *   2. Every bot has access to shared-brain memory tools and durable-agent
 *      delegation tool (Tier 2 fallbacks), automatically wired.
 *   3. Consistent model settings (Sonnet 4.6, temperature 0, stepCountIs 5)
 *      — proven via the bot-chat-test harness.
 */
import {
  generateText,
  stepCountIs,
  tool,
  type ModelMessage,
  type Tool,
  type ToolSet,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { buildGbrainTools } from "@/lib/ai/tools/gbrain";
import { buildDelegateTool } from "@/lib/ai/tools/delegate";

const MODEL_ID = process.env.AI_BOT_MODEL ?? "claude-sonnet-4-6";

/**
 * Why the bot is being invoked. Used to compose the system prompt so the
 * model knows its role and doesn't mimic deferral patterns from prior
 * in-context turns (a real failure mode we hit during testing).
 *
 *   mention            — user explicitly invoked the bot (Stream @mention,
 *                        clicking an "Ask AI" button, typing in a bot-
 *                        specific text box, etc.). Default for non-chat
 *                        surfaces.
 *   auto-classifier    — a classifier judged this message worth replying
 *                        to even though the bot wasn't mentioned.
 *                        (Channel bot's auto mode.)
 *   always-mode        — every message in this channel triggers a reply.
 *                        (Channel bot's always mode.)
 *   engaged-follow-up  — the bot is mid-conversation in a thread and the
 *                        engagement classifier said "respond".
 */
export type ActivationReason =
  | "mention"
  | "auto-classifier"
  | "always-mode"
  | "engaged-follow-up";

export type BotScope = {
  propertyId: string;
  userId: string;
  /** Identifier for the surface invoking the bot — for telemetry. */
  surface:
    | "channel"
    | "doc"
    | "task"
    | "calendar"
    | "search"
    | "onboarding"
    | "comment-thread"
    | "workflow"
    | "workflow-step"
    | "insights";
};

export type RunBotOptions = {
  /** Bot-specific persona — the opening of the system prompt. */
  persona: string;
  /** Why this bot is being invoked. Defaults to "mention". */
  activationReason?: ActivationReason;
  /** Tools tailored to this bot's surface (e.g. get_task_details, edit_document). */
  scopedTools: ToolSet;
  /** Conversation history as ModelMessage[]. The bot generates the next assistant turn. */
  messages: ModelMessage[];
  /** Tenant + user scope. propertyId is critical for tool isolation. */
  scope: BotScope;
  /**
   * Optional: override the default model. Useful for "cheap lookups"
   * bots where Haiku is enough.
   */
  modelId?: string;
  /**
   * Optional: override the default "how to respond" guidelines. Most
   * bots can use the default. Override for bots with different tone
   * needs (e.g. a creative-writing assistant might want more verbosity).
   */
  responseGuidelines?: string;
  /** Max tool-call rounds before stopping. Default 5. */
  maxToolSteps?: number;
  /**
   * Max retries for the underlying model call (AI SDK exponential backoff).
   * Default 3 (= 4 attempts) — covers transient network blips and 529s
   * without making interactive surfaces wait forever on a dead network.
   */
  maxRetries?: number;
};

export type RunBotResult = {
  /**
   * False when generation failed and `text` is a canned apology rather than
   * a real reply. Chat surfaces can post the apology as-is; callers that
   * PERSIST or CACHE `text` (reports, annotations) must check this first —
   * caching the apology poisons the cache until the next forced regen.
   */
  ok: boolean;
  /** The bot's reply text — what gets posted to the user-facing surface. */
  text: string;
  /** Compact observability trace (model, token counts, tool calls) for the
   *  workflow run inspector. Absent on the error path. */
  trace?: {
    model: string;
    tokens: { input: number | null; output: number | null; total: number | null };
    tool_calls: { name: string; input: unknown }[];
  };
  /**
   * Raw model messages from this generation (system + history + tool calls
   * + tool results + assistant text). Surface a copy for callers that
   * persist conversation state (e.g. the channel bot's engaged-mode Redis
   * persistence).
   */
  modelMessages?: ModelMessage[];
};

export const DEFAULT_RESPONSE_GUIDELINES = [
  "Be concise: 1-3 sentences by default. Expand only when the user explicitly asks for detail.",
  "When the question is about specific property data (tasks, docs, meetings, anything tied to this hotel), use the available tools rather than guessing. If a tool returns 0 results, say so plainly — never fabricate.",
  "When the question is broader (operations, planning, judgment calls), share your best take like a knowledgeable colleague.",
  "Only decline when something is genuinely outside your scope: account admin, billing, code changes, anything legally sensitive.",
].join(" ");

const IGNORE_DEFERRAL_GUARD = [
  "If you see prior assistant turns in the conversation history where you said things like 'I wasn't tagged' or 'mention me to bring me back', those were from a buggier version of you. Do not continue that pattern. Per the activation note above, you ARE being asked to respond now.",
].join(" ");

const GBRAIN_GUIDANCE = [
  "You have shared-brain tools available — the property's institutional memory, also read and written by the other bots and the durable agents.",
  "Reading: use `search` for cheap hybrid retrieval when you need raw matches; use `think` for a synthesized answer with citations and gap analysis (more expensive — reserve for hard questions).",
  "Writing: when you learn or confirm something durable about this property (a person's role, a recurring issue, a decision the team made, a preference), use `capture` to record it so future turns — yours and other bots' — can build on it. Skip ephemeral chit-chat. Skip facts already authoritative in Supabase (tasks, docs, calendar events). Capture insights, not lookups.",
].join(" ");

function activationNoteFor(reason: ActivationReason): string {
  switch (reason) {
    case "mention":
      return "The user explicitly invoked you (mention, button click, or direct input). They want your attention — respond.";
    case "auto-classifier":
      return "A classifier just judged that this message would benefit from your input even though you weren't @-mentioned. Don't second-guess that decision and don't ask to be tagged — you're already in the conversation.";
    case "always-mode":
      return "This channel is in 'always respond' mode: the team wants you to respond to every message in this channel, even ones not addressed to you. Respond as a participating teammate. Do NOT say 'I wasn't tagged' or ask the user to mention you — you've been explicitly invited to participate in every message here.";
    case "engaged-follow-up":
      return "You're currently engaged in this conversation. Respond as a continuing participant — the user is following up on something you were just discussing. Don't ask to be re-tagged; you're already in the conversation.";
  }
}

function assembleSystemPrompt(opts: {
  persona: string;
  activationReason: ActivationReason;
  responseGuidelines: string;
  hasGbrain: boolean;
}): string {
  const sections: string[] = [
    opts.persona,
    "",
    "# Why you're responding now",
    activationNoteFor(opts.activationReason),
    "",
    "# How to respond",
    opts.responseGuidelines,
  ];
  if (opts.hasGbrain) {
    sections.push("", "# Shared brain (gbrain)", GBRAIN_GUIDANCE);
  }
  sections.push("", "# Ignore deferral patterns in history", IGNORE_DEFERRAL_GUARD);
  return sections.join("\n");
}

/**
 * Merge the bot's scoped tools with the always-available shared tools
 * (shared-brain memory + durable-agent delegation). Bot-scoped tool names win on
 * collision (extremely unlikely, but better defined than ambiguous).
 *
 * Returns `hasGbrain` so the system prompt can conditionally include
 * gbrain-specific guidance only when the tools are actually present
 * (they're empty when gbrain isn't configured for this property —
 * see `lib/ai/mcp-clients.ts`).
 */
async function mergeTools(
  scopedTools: ToolSet,
  scope: BotScope,
): Promise<{ tools: ToolSet; hasGbrain: boolean }> {
  const [gbrainTools, delegateTool] = await Promise.all([
    buildGbrainTools(scope),
    Promise.resolve(buildDelegateTool(scope)),
  ]);
  // Bot-scoped tools take precedence on name collision.
  return {
    tools: {
      ...gbrainTools,
      ...delegateTool,
      ...scopedTools,
    } as ToolSet,
    hasGbrain: Object.keys(gbrainTools).length > 0,
  };
}

/**
 * Run an in-app bot turn. Returns the reply text plus the raw model
 * transcript for callers that persist conversation state.
 *
 * Failure modes are surfaced via the reply text, not thrown — callers
 * generally render whatever comes back (e.g. "I need ANTHROPIC_API_KEY
 * configured…"), so the bot is always-responsive even when misconfigured.
 * Callers that persist `text` must gate on `ok` — the fallback apology is
 * for humans in a chat surface, never for a cache.
 */
export async function runBot(opts: RunBotOptions): Promise<RunBotResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      text: "I need `ANTHROPIC_API_KEY` configured to respond — ask an admin to set it up.",
    };
  }

  const { tools, hasGbrain } = await mergeTools(opts.scopedTools, opts.scope);
  const system = assembleSystemPrompt({
    persona: opts.persona,
    activationReason: opts.activationReason ?? "mention",
    responseGuidelines: opts.responseGuidelines ?? DEFAULT_RESPONSE_GUIDELINES,
    hasGbrain,
  });

  try {
    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const result = await generateText({
      model: anthropic(opts.modelId ?? MODEL_ID),
      system,
      messages: opts.messages,
      tools,
      // stopWhen: default is stepCountIs(1) — bot would call a tool and
      // never synthesize a reply with the result. 5 leaves headroom for
      // chained tool calls without unbounded loops.
      stopWhen: stepCountIs(opts.maxToolSteps ?? 5),
      // temperature 0 — tool-arg generation is much more reliable, and
      // classifier-style "should I respond" decisions become reproducible.
      temperature: 0,
      maxRetries: opts.maxRetries ?? 3,
    });
    const text = (result.text ?? "").trim() || "(no reply)";
    return {
      ok: true,
      text,
      modelMessages: result.response?.messages,
      trace: {
        model: result.response?.modelId ?? opts.modelId ?? MODEL_ID,
        tokens: {
          input: result.totalUsage?.inputTokens ?? null,
          output: result.totalUsage?.outputTokens ?? null,
          total: result.totalUsage?.totalTokens ?? null,
        },
        tool_calls: result.toolCalls.map((tc) => ({
          name: tc.toolName,
          input: tc.input,
        })),
      },
    };
  } catch (err) {
    console.error("[run-bot] generateText failed", err);
    return {
      ok: false,
      text: "I hit an error generating that reply — try again in a moment.",
    };
  }
}

// Re-export so callers can build typed scoped tools without importing
// `ai` directly. Keeps the "build a bot" import surface tight:
//
//   import { runBot, tool, z, type ToolSet } from "@/lib/ai/run-bot";
//
export { tool, z };
export type { Tool, ToolSet, ModelMessage };
