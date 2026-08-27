import "server-only";
/**
 * Inline contextual document edits — backend for the Liveblocks Tiptap AI
 * Toolkit's "contextual prompt" (the floating "Ask AI" input inside the doc
 * editor). The client's `resolveContextualPrompt` POSTs
 * `{ prompt, context, previous? }` and expects back `{ type, text }`:
 *
 *   selection non-empty → REWRITE it         → type "replace"
 *   selection empty      → GENERATE new text  → type "insert"
 *   error / empty output → fallback           → type "other"
 *
 * Deliberately NOT built on `runBot()`: contextual edits are a single,
 * tool-free, low-latency turn that must return ONLY the resulting prose.
 * `runBot()` would inject gbrain + delegate tools, deferral-guard text,
 * activation-reason sections, and `stopWhen: stepCountIs(5)` — all wrong
 * here. We mirror the lower-level `createAnthropic` + `generateText` style
 * of `lib/ai/run-bot.ts` / `lib/ai/bot-scaffold.ts`.
 *
 * IMPORTANT: the response `type` is decided HERE, server-side, from whether
 * the selection is empty — never by the model. The model only emits prose.
 */
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { samplingParams } from "@/lib/ai/model-settings";

const MODEL_ID = process.env.AI_DOC_CONTEXTUAL_MODEL ?? "claude-sonnet-5";

// Cap so a misread prompt can't dump a huge block into the editor. Internal
// newlines are preserved (multi-paragraph rewrites are valid output).
const MAX_OUTPUT_CHARS = 6000;

export type ContextualEditType = "insert" | "replace" | "other";
export type ContextualEditResult = { type: ContextualEditType; text: string };

export type RunDocContextualEditInput = {
  /** The user's instruction (a suggestion's prompt, or free-form input). */
  prompt: string;
  /** Surrounding text from the editor, truncated by Liveblocks to ~3000 chars. */
  context: {
    beforeSelection: string;
    selection: string;
    afterSelection: string;
  };
  /** Prior AI answer on a "Try again" refinement, if any. */
  previous?: ContextualEditResult;
};

const SYSTEM_PROMPT = [
  "You are an inline writing assistant embedded directly in a hotel-operations document editor (SOPs, proposals, meeting notes, policies).",
  "You operate on a single selection or cursor position. Two modes:",
  "",
  "1. REWRITE mode — when a non-empty SELECTION is provided, you are rewriting EXACTLY that selected text per the user's instruction. Return only the rewritten replacement for the selection. Do not echo the surrounding text.",
  "2. INSERT mode — when the SELECTION is empty, you are generating brand-new text to insert at the cursor, between BEFORE and AFTER. Return only the new text to insert.",
  "",
  "BEFORE and AFTER are surrounding context ONLY — use them to match the document's voice, tense, tone, and formatting. Never repeat or modify them; they are not part of your output.",
  "Preserve load-bearing facts exactly: names, numbers, room numbers, times, dates, and deadlines. Never invent owners, dates, or policies that aren't present.",
  "",
  "Output rules (strict):",
  "- Output ONLY the resulting prose. No preamble, no explanation, no sign-off.",
  "- Do NOT wrap the output in quotes.",
  "- Do NOT wrap the output in markdown code fences.",
  "- Do NOT add a heading or label like 'Rewrite:' or 'Here is'.",
  "- Match the surrounding formatting: plain prose unless the selection itself was a list/heading.",
  "- Keep it tight and on-instruction. Don't pad.",
].join("\n");

function buildUserMessage(input: RunDocContextualEditInput): string {
  const { prompt, context, previous } = input;
  const isRewrite = context.selection.trim().length > 0;
  const parts: string[] = [];

  parts.push(isRewrite ? "MODE: REWRITE" : "MODE: INSERT");
  parts.push("", "INSTRUCTION:", prompt.trim(), "");
  parts.push("BEFORE (context, do not output):");
  parts.push(context.beforeSelection || "(start of document)");
  parts.push("");
  if (isRewrite) {
    parts.push("SELECTION (rewrite this — your output replaces it):");
    parts.push(context.selection);
  } else {
    parts.push("CURSOR is here — generate text to insert at this point.");
  }
  parts.push("", "AFTER (context, do not output):");
  parts.push(context.afterSelection || "(end of document)");

  if (previous && previous.text.trim()) {
    parts.push("");
    parts.push(
      "Your PREVIOUS answer is below. The user is refining it — improve on it per the instruction rather than starting over:",
    );
    parts.push(previous.text);
  }
  return parts.join("\n");
}

/**
 * Strip a single wrapping markdown fence and one pair of wrapping quotes —
 * models add these despite instructions. Internal newlines are preserved.
 */
function cleanOutput(raw: string): string {
  let text = raw.trim();

  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();

  const wraps: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"], // “ ”
  ];
  for (const [open, close] of wraps) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(1, -1).trim();
      break;
    }
  }

  if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS);
  return text;
}

export async function runDocContextualEdit(
  input: RunDocContextualEditInput,
): Promise<ContextualEditResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      type: "other",
      text: "I need `ANTHROPIC_API_KEY` configured to do that — ask an admin to set it up.",
    };
  }

  // Type is decided HERE from selection emptiness — never by the model.
  const isRewrite = input.context.selection.trim().length > 0;
  const type: ContextualEditType = isRewrite ? "replace" : "insert";

  try {
    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const { text } = await generateText({
      model: anthropic(MODEL_ID),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(input) }],
      // No tools → single turn; the default stopWhen is correct here.
      // temperature 0.4 (a little warmth for free-form prose) only on models
      // that still accept sampling params — see lib/ai/model-settings.ts.
      ...samplingParams(MODEL_ID, 0.4),
    });
    const cleaned = cleanOutput(text ?? "");
    if (!cleaned) return { type: "other", text: "" };
    return { type, text: cleaned };
  } catch (err) {
    console.error("[doc-contextual] generateText failed", err);
    return {
      type: "other",
      text: "I hit an error generating that — try again in a moment.",
    };
  }
}
