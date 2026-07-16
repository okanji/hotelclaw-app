import "server-only";
/**
 * Auto-mode classifier for the in-channel AI bot.
 *
 * Runs on every non-bot, non-mention message when the channel's `ai_mode`
 * is `"auto"`. Decides whether the bot should chime in. Two rules apply at
 * every sensitivity (the auto-mode product contract): the bot always
 * responds when the user is continuing a conversation with it, and when the
 * message asks for something within its tool capabilities. Everything else
 * defaults to no, tuned by the sensitivity prompt below.
 *
 * Uses Claude Haiku (cheap + fast) with a structured JSON output. The
 * `reason` field comes back so we can log why a decision was made; it's
 * not surfaced to users.
 *
 * Cost: ~$0.0001 per message at typical sizes (8 short history turns +
 * one short trigger + ~50 token JSON output).
 *
 * Env vars:
 *   ANTHROPIC_API_KEY              — required.
 *   STREAM_BOT_CLASSIFIER_MODEL    — optional; defaults to claude-haiku-4-5.
 */
import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { BOT_DISPLAY_NAME } from "@/lib/ai/bot-identity";
import { prefixUser, type HistoryTurn } from "./ai-history";

export type ChimeSensitivity = "conservative" | "balanced" | "eager";

const CLASSIFIER_MODEL_ID =
  process.env.STREAM_BOT_CLASSIFIER_MODEL ?? "claude-haiku-4-5";

const DecisionSchema = z.object({
  should_respond: z
    .boolean()
    .describe("Whether the bot should chime in on the latest message."),
  reason: z
    .string()
    .describe(
      "One short sentence justifying the decision. For logging only — not shown to users. Keep brief but don't artificially truncate.",
    ),
});

export type ChimeDecision = z.infer<typeof DecisionSchema>;

const HEADER = `You decide whether ${BOT_DISPLAY_NAME} — an AI teammate in a hotel-operations chat — should speak in response to the latest message. In the conversation below, ${BOT_DISPLAY_NAME}'s own past messages are the assistant turns.`;

const CAPABILITIES = [
  `What ${BOT_DISPLAY_NAME} can actually DO (via tools): list and filter open tasks / workload / what's blocked; search property documents, SOPs, and policies; list upcoming meetings; look up the org chart (who owns what, reporting lines, team leads); answer property-data questions from those sources; and delegate longer-running work (monitoring, scheduled reports, automations).`,
].join("\n");

// Sensitivity tunes the DISCRETIONARY rules below, but these two are the
// product contract for auto mode and apply at every sensitivity: the bot is
// always listening, and it must never ghost someone who is (a) talking to it
// or (b) asking for something it can directly do.
const UNIVERSAL_RULES = [
  "ALWAYS return should_respond=true when either of these applies — they override every skip rule below:",
  `  A. The latest message continues a conversation with ${BOT_DISPLAY_NAME}: it replies to, reacts to, asks a follow-up about, or answers something in ${BOT_DISPLAY_NAME}'s most recent message (e.g. 'yes do that', 'what about the second one?', 'go ahead'), or it addresses the bot by name or generically ('AI', 'bot', '${BOT_DISPLAY_NAME}', 'hey ai …').`,
  "  B. The message asks for — or states a need that maps onto — something in the capability list above, even if nobody addressed the bot directly (e.g. 'what's still open?', 'someone should find the fire-safety SOP', 'who owns housekeeping?').",
].join("\n");

const COMMON_TAIL = [
  "",
  "When neither A nor B applies, default to should_respond=false. The cost of staying silent is low; the cost of chiming in unnecessarily is high (annoying, breaks the team's flow).",
  "",
  'Respond with JSON only, matching the schema {"should_respond": boolean, "reason": string}.',
].join("\n");

const CONSERVATIVE_PROMPT = [
  HEADER,
  "",
  CAPABILITIES,
  "",
  UNIVERSAL_RULES,
  "",
  "Beyond A and B, also return should_respond=true if ONE of these clearly applies:",
  "  1. The message is a direct question that doesn't appear to be addressed to a specific human teammate.",
  "  2. The message contains a factual claim Hotelclaw has specific reason to believe is wrong.",
  "",
  "Skip everything else: greetings, emoji, '+1' / 'ok' / 'thanks', coordination between specific named people, jokes, personal topics, opinions, anything where the team is already converging.",
  COMMON_TAIL,
].join("\n");

const BALANCED_PROMPT = [
  HEADER,
  "",
  CAPABILITIES,
  "",
  UNIVERSAL_RULES,
  "",
  "Beyond A and B, also return should_respond=true if ONE of these clearly applies:",
  "  1. The message is a question that doesn't appear to be directed at a specific human teammate.",
  "  2. The message contains a factual claim Hotelclaw has specific reason to believe is wrong.",
  "  3. The conversation references tasks, documents, meetings, or property data that Hotelclaw could look up and add value by surfacing.",
  "  4. The discussion is ambiguous in a way a brief clarifying question would unblock.",
  "",
  "Skip: greetings, emoji, '+1' / 'ok' / 'thanks', coordination between specific named people ('@bob can you…'), jokes, personal/sensitive topics, anything where the room is already converging on an answer.",
  COMMON_TAIL,
].join("\n");

const EAGER_PROMPT = [
  HEADER,
  "",
  CAPABILITIES,
  "",
  UNIVERSAL_RULES,
  "",
  "Beyond A and B, also return should_respond=true when ANY of these apply:",
  "  1. The message is a question that doesn't appear to be directed at a specific human teammate.",
  "  2. The message contains a factual claim Hotelclaw has reason to believe is wrong.",
  "  3. The conversation references tasks, documents, meetings, or property data Hotelclaw could surface.",
  "  4. The discussion is ambiguous and a brief clarifying question would unblock it.",
  "  5. You have relevant context, a quick summary, or a useful suggestion that would genuinely help.",
  "",
  "Still skip pure greetings, emoji, '+1', and direct 1:1 coordination ('@bob can you…').",
  "Keep replies brief — even when chiming in, Hotelclaw should be terse.",
  COMMON_TAIL,
].join("\n");

function promptFor(sensitivity: ChimeSensitivity): string {
  switch (sensitivity) {
    case "conservative":
      return CONSERVATIVE_PROMPT;
    case "eager":
      return EAGER_PROMPT;
    case "balanced":
    default:
      return BALANCED_PROMPT;
  }
}

export type ClassifierInput = {
  /** Last N history turns from the channel. Bot's own past replies are role=assistant. */
  history: HistoryTurn[];
  /** The new message that just arrived. */
  triggerMessage: {
    text: string;
    userId: string;
    userName?: string | null;
  };
  sensitivity: ChimeSensitivity;
};

/**
 * Returns true if the bot should respond. On any classifier error, returns
 * false (fail-closed: prefer silence over spurious replies).
 */
export async function shouldBotChimeIn(
  input: ClassifierInput,
): Promise<{ should_respond: boolean; reason: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { should_respond: false, reason: "no-api-key" };
  }
  try {
    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const triggerLine = prefixUser({
      text: input.triggerMessage.text,
      userName: input.triggerMessage.userName ?? null,
      userId: input.triggerMessage.userId,
    });
    // Cap history; we don't need 20 turns for a binary decision.
    const recent = input.history.slice(-8);
    // temperature: 0 — binary classification benefits from determinism.
    // Same prompt + same context should give the same decision; entropy here
    // hurts more than it helps.
    //
    // Note: considered Output.choice (cheaper structured-output primitive)
    // but kept generateObject so we can include `reason` for log-based prompt
    // tuning. Revisit once prompts are stable.
    const result = await generateObject({
      model: anthropic(CLASSIFIER_MODEL_ID),
      system: promptFor(input.sensitivity),
      schema: DecisionSchema,
      messages: [
        ...recent.map((h) => ({ role: h.role, content: h.content })),
        { role: "user" as const, content: triggerLine },
      ],
      temperature: 0,
    });
    return result.object;
  } catch (err) {
    console.error("[ai-auto-classifier] generateObject failed", err);
    return { should_respond: false, reason: "classifier-error" };
  }
}
