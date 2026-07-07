import "server-only";
/**
 * Engaged-mode classifier.
 *
 * Runs on every message in a thread (or channel top-level) that the bot is
 * currently engaged in, AND on candidate "spinoff" messages — first-touch
 * messages in a thread or channel that's structurally adjacent to the
 * engaged conversation.
 *
 * Three-way decision:
 *   respond     — message is on-topic AND would benefit from a reply
 *   stay_silent — on-topic but between humans, bot listens but doesn't speak
 *   disengage   — topic resolved / shifted / addressed elsewhere → bot signs
 *                 off and returns to idle for this thread
 *
 * The bot defaults to `disengage` on ambiguity. Cost of overstaying is high
 * (annoying); cost of disengaging is low (user can @-mention again).
 *
 * Uses Haiku (`STREAM_BOT_CLASSIFIER_MODEL`, default claude-haiku-4-5) — same
 * cheap-classifier tier as auto mode. Structured JSON output via
 * `generateObject` so we can rely on the schema.
 *
 * Cost: ~1 Haiku call per message while engaged in a thread. Spinoff calls
 * are at most once per unique unengaged thread per engagement session,
 * bounded by `ai_skipped_threads`.
 */
import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { BOT_DISPLAY_NAME } from "@/lib/ai/bot-identity";
import { prefixUser, type HistoryTurn } from "./ai-history";

const CLASSIFIER_MODEL_ID =
  process.env.STREAM_BOT_CLASSIFIER_MODEL ?? "claude-haiku-4-5";

const DecisionSchema = z.object({
  decision: z
    .enum(["respond", "stay_silent", "disengage"])
    .describe(
      "respond: on-topic and warrants reply. stay_silent: on-topic but between humans, no reply needed. disengage: topic resolved/shifted or now between specific humans; bot exits.",
    ),
  reason: z
    .string()
    .describe(
      "One short sentence justifying the decision. For logging only — not shown to users. Keep brief but don't artificially truncate.",
    ),
});

export type EngagementDecision = z.infer<typeof DecisionSchema>;

const ENGAGED_SYSTEM_PROMPT = [
  `You are deciding what ${BOT_DISPLAY_NAME} — an AI teammate currently engaged in a conversation in a hotel-operations chat — should do with the latest message.`,
  "",
  "Three choices:",
  "  - **respond**: the message is addressed to you OR is a question/request that would naturally be answered by the AI teammate in the conversation. Includes follow-ups, clarifications, 'which one', 'what about X', 'why', 'can you also...', or any direct query — even if the answer touches material you already covered. If the user is asking, you answer.",
  "  - **stay_silent**: the message is clearly between OTHER humans and not directed at you (e.g., 'alice, can you handle that?', 'bob what do you think', or pure between-teammates coordination). Keep listening, don't speak.",
  "  - **disengage**: the topic is fully resolved (thanks/got it/perfect/👍 with no follow-up question), OR the conversation has shifted to a different subject the AI teammate isn't in, OR someone explicitly tells the bot to stop.",
  "",
  "**Important:**",
  "- If the latest message is a question or request and you (the bot) could meaningfully answer it, choose **respond**. Don't choose stay_silent because 'we already covered this' — clarifying questions deserve a reply.",
  "- Only choose stay_silent when there's clear evidence the message is between other humans (named recipients, side coordination).",
  "- Only choose disengage when the conversation is genuinely done. A 'thanks' followed by another question is NOT done — it's a transition.",
  "",
  "**Multi-participant**: this is a group conversation. Respond to whoever needs help — engagement is owned by the thread, not by the original mentioner.",
  "",
  'Respond with the JSON object only, matching the schema {"decision": "respond"|"stay_silent"|"disengage", "reason": string}.',
].join("\n");

const SPINOFF_SYSTEM_PROMPT = [
  `You are deciding whether ${BOT_DISPLAY_NAME} — an AI teammate currently engaged in another conversation in this same channel — should also engage HERE.`,
  "",
  "Context: the bot is in the middle of another conversation in this channel. A new message just arrived in a different thread (or back at the channel top-level). Your job is to decide whether this new message is part of the same conversation the bot is already in (a forked discussion of the same topic) or genuinely separate.",
  "",
  "Three choices (matching the engaged-mode decision shape):",
  "  - respond: this message IS a continuation of the engaged conversation AND would benefit from a reply. Bot will start engaging here too.",
  "  - stay_silent: probably a continuation but doesn't need a reply yet. We won't engage here — the bot can be re-evaluated if more comes in. (Equivalent to disengage for spinoff purposes — both mean 'don't engage'.)",
  "  - disengage: not related to the engaged conversation. Stay out of this thread/channel.",
  "",
  "Default to **disengage** if you're unsure. The bot can always be @-mentioned to engage explicitly.",
  "",
  'Respond with the JSON object only, matching the schema {"decision": "respond"|"stay_silent"|"disengage", "reason": string}.',
].join("\n");

export type EngagementClassifierInput = {
  history: HistoryTurn[];
  triggerMessage: {
    text: string;
    userId: string;
    userName?: string | null;
  };
  /**
   * When set, this is a spinoff evaluation: the engaged conversation's
   * history is provided here, and `history` is the new thread/channel
   * being evaluated. The prompt is swapped for the spinoff variant.
   */
  spinoffContext?: HistoryTurn[];
};

/**
 * Returns the 3-way decision. Fail-closed: on classifier error, returns
 * `disengage` so the bot exits rather than getting stuck replying.
 */
export async function shouldStayEngaged(
  input: EngagementClassifierInput,
): Promise<EngagementDecision> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { decision: "disengage", reason: "no-api-key" };
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

    const messages = input.spinoffContext
      ? buildSpinoffMessages(input.spinoffContext, input.history, triggerLine)
      : buildEngagedMessages(input.history, triggerLine);

    // temperature: 0 — same reasoning as the auto classifier. The 3-way
    // decision should be reproducible for a given input; we want to debug
    // mis-fires by reading the prompt + history, not by chasing entropy.
    const result = await generateObject({
      model: anthropic(CLASSIFIER_MODEL_ID),
      system: input.spinoffContext ? SPINOFF_SYSTEM_PROMPT : ENGAGED_SYSTEM_PROMPT,
      schema: DecisionSchema,
      messages,
      temperature: 0,
    });
    return result.object;
  } catch (err) {
    console.error("[ai-engagement-classifier] generateObject failed", err);
    return { decision: "disengage", reason: "classifier-error" };
  }
}

function buildEngagedMessages(
  history: HistoryTurn[],
  triggerLine: string,
): { role: "user" | "assistant"; content: string }[] {
  const recent = history.slice(-10);
  return [
    ...recent.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: triggerLine },
  ];
}

function buildSpinoffMessages(
  engagedContext: HistoryTurn[],
  thisLocationHistory: HistoryTurn[],
  triggerLine: string,
): { role: "user" | "assistant"; content: string }[] {
  // Inject the engaged-conversation context as a single synthetic "user"
  // turn so we don't confuse the model into thinking it's been speaking
  // as the assistant in that other thread. The actual conversation history
  // for this thread/channel goes into the role-tagged turns.
  const engagedSummary = engagedContext
    .slice(-8)
    .map((h) => (h.role === "assistant" ? `bot: ${h.content}` : h.content))
    .join("\n");
  const intro = engagedSummary
    ? `Context — the bot is currently engaged in a conversation in this same channel. Recent turns of that conversation (for reference only, not the thread/channel you're evaluating):\n\n${engagedSummary}\n\n— end of engaged context —\n\nNow evaluate the following thread or channel.`
    : "(No engaged context available — evaluate the following on its own merits.)";

  const recent = thisLocationHistory.slice(-6);
  return [
    { role: "user", content: intro },
    ...recent.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: triggerLine },
  ];
}
