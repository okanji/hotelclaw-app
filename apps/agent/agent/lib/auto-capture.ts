/**
 * Auto-capture: the learning half of memory that does not depend on the
 * model remembering to call `remember`.
 *
 * eve calls `capture["turn.completed"]` with the SETTLED history after each
 * successful turn (docs/memory/custom-provider). This module reads only the
 * finished turn, asks Haiku for at most three durable facts a colleague would
 * want next week (not the transcript), drops anything already known, and
 * writes the rest as low-importance `auto` memories — property facts to the
 * property slot, a person's preferences to their person slot. The nightly
 * consolidator (apps/web lib/memory/learn.ts) later merges and prunes them.
 *
 * Guards, each for a reason:
 *   - idempotent on eve's `operationId` (a replayed handler must not write
 *     twice) — the id is stamped into `source`;
 *   - cost gate: a short tool-less turn ("thanks", "approve") teaches
 *     nothing, so no model call;
 *   - confidence ≥ 0.75 and 20–400 chars: fragments and hedges are noise;
 *   - fail-soft: a throwing capture is only logged by eve, but we also catch
 *     locally so a provider outage never shows up as a warning storm.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output, type ModelMessage } from "ai";
import { z } from "zod";
import {
  MEMORY_KINDS,
  type MemoryScope,
  type MemoryStore,
} from "@hotelclaw/memory";

const CAPTURE_MODEL = process.env.AI_FAST_MODEL || "claude-haiku-5-5";
const MIN_TEXT_WITHOUT_TOOLS = 300;
const MAX_TRANSCRIPT_CHARS = 14_000;

const Extraction = z.object({
  memories: z
    .array(
      z.object({
        scope: z
          .enum(["property", "person"])
          .describe("property = true of the hotel/team; person = how THIS person wants things done"),
        kind: z.enum(MEMORY_KINDS),
        content: z
          .string()
          .describe("One self-contained sentence, specific names/numbers included, no 'the user said'"),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(3),
});

const INSTRUCTIONS = [
  "You distil durable memory from one finished turn between a hotel team member and their AI assistant.",
  "Return at most 3 memories, often 0. A memory is something a colleague would still want to know next week:",
  "- a fact about the property that is NOT already a task/document record (who owns what, where things are, supplier behaviour, recurring problems and their cause, decisions and why);",
  "- an outcome of real work done in this turn (what was changed and the result), only if it matters later;",
  "- a correction the person made, or a standing preference about how they want answers or work done (scope = person).",
  "Never store: greetings, the question itself, anything the assistant merely looked up from live records, speculation, secrets, or anything already in the 'Already known' list (or a trivial rewording of it).",
  "Write each memory as one plain sentence with the concrete names, places, numbers. Confidence below 0.75 means skip.",
].join("\n");

type Extracted = z.infer<typeof Extraction>["memories"][number];

export function turnTail(messages: readonly ModelMessage[]): ModelMessage[] {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  return lastUser < 0 ? [...messages] : messages.slice(lastUser);
}

function contentToText(content: ModelMessage["content"]): {
  text: string;
  toolCalls: number;
} {
  if (typeof content === "string") return { text: content, toolCalls: 0 };
  let text = "";
  let toolCalls = 0;
  for (const part of content as Array<Record<string, unknown>>) {
    if (part.type === "text" && typeof part.text === "string") text += part.text + "\n";
    else if (part.type === "tool-call") {
      toolCalls += 1;
      text += `[called ${String(part.toolName)} ${JSON.stringify(part.input ?? {}).slice(0, 300)}]\n`;
    } else if (part.type === "tool-result") {
      const out = part.output as { value?: unknown } | undefined;
      text += `[result ${String(part.toolName)}: ${JSON.stringify(out?.value ?? out ?? "").slice(0, 500)}]\n`;
    }
  }
  return { text, toolCalls };
}

/** Render the finished turn for the extractor; null when it can't teach. */
export function renderTurn(messages: readonly ModelMessage[]): string | null {
  const tail = turnTail(messages);
  let out = "";
  let toolCalls = 0;
  let assistantChars = 0;
  for (const message of tail) {
    const { text, toolCalls: calls } = contentToText(message.content);
    toolCalls += calls;
    if (message.role === "assistant") assistantChars += text.length;
    const role = message.role === "tool" ? "tool" : message.role;
    out += `${role.toUpperCase()}: ${text.trim()}\n\n`;
  }
  const userText = tail.find((m) => m.role === "user");
  const userChars = userText ? contentToText(userText.content).text.trim().length : 0;
  // Bare acknowledgements and approvals teach nothing.
  if (userChars < 12 && toolCalls === 0) return null;
  if (toolCalls === 0 && assistantChars < MIN_TEXT_WITHOUT_TOOLS) return null;
  if (out.length > MAX_TRANSCRIPT_CHARS) {
    out = out.slice(0, MAX_TRANSCRIPT_CHARS / 2) + "\n…\n" + out.slice(-MAX_TRANSCRIPT_CHARS / 2);
  }
  return out;
}

export async function autoCapture(input: {
  store: MemoryStore;
  property: MemoryScope;
  person: MemoryScope | null;
  messages: readonly ModelMessage[];
  operationId: string;
  authorId: string | null;
}): Promise<{ written: number; skipped: string }> {
  const { store, property, person } = input;
  if (!process.env.ANTHROPIC_API_KEY) return { written: 0, skipped: "no-key" };

  const transcript = renderTurn(input.messages);
  if (!transcript) return { written: 0, skipped: "cost-gate" };

  const token = `op:${input.operationId}`;
  if (await store.existsBySourceToken(property.propertyId, token)) {
    return { written: 0, skipped: "replay" };
  }

  const [known, knownPerson] = await Promise.all([
    store.recent(property, 15),
    person ? store.recent(person, 8) : Promise.resolve([]),
  ]);
  const knownLines = [...known, ...knownPerson].map((r) => `- ${r.content}`).join("\n");

  let extracted: Extracted[] = [];
  try {
    const { output } = await generateText({
      model: anthropic(CAPTURE_MODEL),
      instructions: INSTRUCTIONS,
      prompt: [
        knownLines ? `Already known:\n${knownLines}` : "Already known: (nothing yet)",
        "",
        "Turn:",
        transcript,
      ].join("\n"),
      output: Output.object({ schema: Extraction }),
      maxRetries: 1,
    });
    extracted = output?.memories ?? [];
  } catch (err) {
    console.warn("[auto-capture] extraction failed", err);
    return { written: 0, skipped: "model" };
  }

  const date = new Date().toISOString().slice(0, 10);
  let written = 0;
  for (const memory of extracted) {
    const content = memory.content.trim();
    if (memory.confidence < 0.75 || content.length < 20 || content.length > 400) continue;
    const scope = memory.scope === "person" ? (person ?? property) : property;
    try {
      const saved = await store.remember({
        scope,
        content,
        kind: memory.kind,
        source: `auto-capture ${date} ${token}`,
        tags: ["auto"],
        importance: 1,
        createdBy: input.authorId,
        createdVia: "agent",
      });
      if (!saved.duplicate) written += 1;
    } catch (err) {
      console.warn("[auto-capture] write skipped", err);
    }
  }
  return { written, skipped: written === 0 ? "nothing-durable" : "" };
}
