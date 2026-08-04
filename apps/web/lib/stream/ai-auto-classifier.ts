import "server-only";
/**
 * Auto-mode classifier for the in-channel AI bot.
 *
 * Runs on every non-bot, non-mention message when the channel's `ai_mode`
 * is `"auto"`. Decides whether the bot should chime in. Two rules apply at
 * every sensitivity (the auto-mode product contract): the bot always
 * responds when the user is continuing a conversation with it, and when the
 * message asks for something within its tool capabilities. Both are answered
 * as their own schema fields and ENFORCED IN CODE — the model would
 * otherwise recognise a rule and still decline (see DecisionSchema).
 * Everything else defaults to no, tuned by the sensitivity prompt below.
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
import { botCapabilityBlurb } from "./ai-capability-map";
import { prefixUser, type HistoryTurn } from "./ai-history";

export type ChimeSensitivity = "conservative" | "balanced" | "eager";

const CLASSIFIER_MODEL_ID =
  process.env.STREAM_BOT_CLASSIFIER_MODEL ?? "claude-haiku-4-5";

// The two ALWAYS-respond rules are answered as their OWN fields before the
// verdict, and enforced in code below — asking the model to honour them
// inside a single boolean did not work. Observed 2026-08-03: on the
// follow-up "which of those would you start with?" the classifier returned
// should_respond=false with the reason "override rule A applies, but I've
// already answered this ... repeating would be redundant" — it recognised
// the rule and then talked itself out of it, so auto mode silently required
// a fresh @-mention for every follow-up.
const DecisionSchema = z.object({
  continues_bot_conversation: z
    .boolean()
    .describe(
      "Rule A — the latest message is part of an ongoing exchange with the bot AND wants something from it. Mechanical check, not a judgement call.",
    ),
  asks_for_capability: z
    .boolean()
    .describe(
      "Rule B — the message asks the room (not one named person) for something on the bot's capability list. Mechanical check, not a judgement call.",
    ),
  should_respond: z
    .boolean()
    .describe(
      "Whether the bot should chime in on the latest message. MUST be true whenever either rule flag is true.",
    ),
  reason: z
    .string()
    .describe(
      "One short sentence justifying the decision. For logging only — not shown to users. Keep brief but don't artificially truncate.",
    ),
});

export type ChimeDecision = { should_respond: boolean; reason: string };

const HEADER = `You decide whether ${BOT_DISPLAY_NAME} — an AI teammate in a hotel-operations chat — should speak in response to the latest message. In the conversation below, ${BOT_DISPLAY_NAME}'s own past messages are the assistant turns.`;

// Kept honest against the runtime's actual grants by a drift guard in
// lib/agents/__tests__/agent-runtime-sync.test.ts — rule B is judged against
// this list, so anything missing from it is a capability auto mode refuses
// to volunteer.
const CAPABILITIES = botCapabilityBlurb(BOT_DISPLAY_NAME);

// Sensitivity tunes the DISCRETIONARY rules below, but these two are the
// product contract for auto mode and apply at every sensitivity: the bot is
// always listening, and it must never ghost someone who is (a) talking to it
// or (b) asking for something it can directly do. They are answered as
// separate schema fields and force the verdict in code — prose alone lost to
// the model's own editorialising.
const UNIVERSAL_RULES = [
  "STEP 1 — answer these two mechanical checks. They are not judgement calls: do not weigh them against usefulness, redundancy, timing, or whether the team is already handling it.",
  "",
  `  continues_bot_conversation (rule A) — TRUE when the latest message is part of an ongoing exchange with ${BOT_DISPLAY_NAME} AND wants something from it: a follow-up, a narrowing ('which of those?', 'what about the second one?'), a challenge ('are you sure?', 'why?'), an answer to a question ${BOT_DISPLAY_NAME} asked, a go-ahead ('yes, do that', 'go ahead'), or any message that addresses it ('${BOT_DISPLAY_NAME}', 'AI', 'bot', 'hey ai …').`,
  `    • Already answered it? STILL TRUE. A follow-up that re-asks, narrows, or re-frames something ${BOT_DISPLAY_NAME} just covered is exactly the case it must answer again. Redundancy is never a reason to go silent.`,
  "    • Pure acknowledgement that asks nothing ('thanks', 'got it', '👍', 'perfect') → FALSE.",
  "",
  `  asks_for_capability (rule B) — TRUE when the message asks the room for something on ${BOT_DISPLAY_NAME}'s capability list above, or states a need that maps onto it: 'what's still open?', 'someone should find the fire-safety SOP', 'can we fit a table for six tonight?', 'who owns housekeeping?', 'we need a feedback form for the staff'.`,
  "    • Aimed at a specific named teammate ('@Sam can you restock the minibars?') → FALSE. That's their job, not the bot's.",
  "",
  "If EITHER flag is true, should_respond MUST be true. There is no exception.",
].join("\n");

const COMMON_TAIL = [
  "",
  "With both flags false and none of the discretionary rules clearly applying, return should_respond=false. The cost of staying silent is low; the cost of chiming in unnecessarily is high (annoying, breaks the team's flow).",
  "",
  'Respond with JSON only, matching the schema {"continues_bot_conversation": boolean, "asks_for_capability": boolean, "should_respond": boolean, "reason": string}.',
].join("\n");

const CONSERVATIVE_PROMPT = [
  HEADER,
  "",
  CAPABILITIES,
  "",
  UNIVERSAL_RULES,
  "",
  "STEP 2 — only when BOTH flags are false, use judgement. Return should_respond=true if ONE of these clearly applies:",
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
  "STEP 2 — only when BOTH flags are false, use judgement. Return should_respond=true if ONE of these clearly applies:",
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
  "STEP 2 — only when BOTH flags are false, use judgement. Return should_respond=true when ANY of these apply:",
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

    // The two contract rules are enforced HERE, not left to the verdict
    // field: the model demonstrably acknowledges a rule and then declines
    // anyway ("rule A applies, but I already answered that"). A flag it set
    // itself is the closest thing to a mechanical check we can get, so a
    // true flag wins over its own should_respond.
    const { continues_bot_conversation, asks_for_capability } = result.object;
    const forcedBy = continues_bot_conversation
      ? "A (continues the conversation)"
      : asks_for_capability
        ? "B (asks for a capability)"
        : null;
    if (forcedBy && !result.object.should_respond) {
      return {
        should_respond: true,
        reason: `forced by rule ${forcedBy} — model had said no: ${result.object.reason}`,
      };
    }
    return {
      should_respond: result.object.should_respond,
      reason: result.object.reason,
    };
  } catch (err) {
    console.error("[ai-auto-classifier] generateObject failed", err);
    return { should_respond: false, reason: "classifier-error" };
  }
}
