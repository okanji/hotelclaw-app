import "server-only";
/**
 * The learning loop's two server-side halves, run nightly by
 * `/api/memory/consolidate` (and callable on demand):
 *
 *   1. `distillFeedback` — DETERMINISTIC. Every 👎 (or 👍) with a note on an
 *      AI reply (`ai_feedback`, migration 0105) becomes a per-person
 *      `preference` memory in that person's slot, so the next turn with them
 *      is recalled "Prefers totals first; said so after a reply about the
 *      weekly report". No model: the person's own words are the memory.
 *   2. `consolidateMemories` — Haiku. Auto-captured memories (tag `auto`,
 *      importance 1) accumulate one or three per turn; left alone they turn
 *      recall into noise. Once a scope holds enough of them older than a
 *      week, the model merges overlapping ones into fewer, clearer facts
 *      (tag `consolidated`, importance 2) and the originals are soft-
 *      forgotten (superseded_at) — never hard-deleted, so the browser's
 *      history and the audit trail survive. Pinned and member-written
 *      memories are never touched.
 */
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  type MemoryRecord,
  type MemoryScope,
  type MemorySubjectKind,
} from "@hotelclaw/memory";
import { createServiceClient } from "@/lib/supabase/server";
import { memoryStore } from "@/lib/memory/store";

const CONSOLIDATE_MODEL = process.env.AI_FAST_MODEL ?? "claude-haiku-5-5";
/** Auto memories per scope before a merge pass is worth a model call. */
export const CONSOLIDATE_THRESHOLD = 25;
const CONSOLIDATE_MIN_AGE_DAYS = 7;
const CONSOLIDATE_BATCH = 60;

/* ───────────────────────────── feedback ───────────────────────────── */

export function feedbackToMemory(row: {
  rating: number;
  note: string | null;
  excerpt: string | null;
  surface: string;
}): string | null {
  const note = row.note?.trim();
  if (!note) return null;
  const about = row.excerpt?.trim().replace(/\s+/g, " ").slice(0, 120);
  const verdict = row.rating < 0 ? "Correction" : "Liked";
  return `${verdict} (${row.surface}): ${note}${about ? ` — said about a reply that began "${about}…"` : ""}`;
}

export async function distillFeedback(propertyId: string): Promise<{ distilled: number }> {
  const supabase = createServiceClient();
  const { data: rows, error } = await supabase
    .from("ai_feedback")
    .select("id, user_id, surface, rating, note, excerpt")
    .eq("property_id", propertyId)
    .is("distilled_at", null)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`ai_feedback read failed: ${error.message}`);

  const store = memoryStore();
  let distilled = 0;
  for (const row of rows ?? []) {
    const content = feedbackToMemory(row);
    if (content) {
      const token = `feedback:${row.id}`;
      const already = await store.existsBySourceToken(propertyId, token);
      if (!already) {
        await store.remember({
          scope: { propertyId, subjectKind: "user", subjectId: row.user_id },
          content: content.slice(0, 600),
          kind: "preference",
          source: `${token} ${new Date().toISOString().slice(0, 10)}`,
          tags: ["feedback", row.rating < 0 ? "correction" : "praise"],
          importance: 2,
          createdBy: row.user_id,
          createdVia: "app",
        });
        distilled += 1;
      }
    }
    await supabase
      .from("ai_feedback")
      .update({ distilled_at: new Date().toISOString() })
      .eq("id", row.id);
  }
  return { distilled };
}

/* ──────────────────────────── consolidation ───────────────────────── */

const Merge = z.object({
  merged: z
    .array(
      z.object({
        content: z.string().describe("One clear, specific sentence or two"),
        kind: z.enum(["fact", "preference", "event", "outcome", "playbook"]),
        /** Short ids (first 8 hex chars) of the memories this replaces. */
        replaces: z.array(z.string()).min(1),
      }),
    )
    .max(15),
  /** Short ids that are stale, trivial, or duplicates and should be dropped outright. */
  drop: z.array(z.string()),
});

const MERGE_INSTRUCTIONS = [
  "You curate an AI assistant's long-term memory for one hotel property. You receive auto-captured memories (each with a short id and date).",
  "Produce a smaller, better set: merge memories that say the same thing or describe the same subject into ONE precise entry (keep names, numbers, dates; prefer the newest when they conflict), and list which ids each entry replaces.",
  "Put ids you want removed without replacement in `drop`: chit-chat residue, one-off trivia with no future value, exact duplicates, or anything that reads as speculation.",
  "Leave a memory alone (mention it nowhere) when it is already clear and unique. Never invent content that is not supported by the inputs.",
].join("\n");

function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

async function autoMemoriesFor(
  scope: MemoryScope,
  olderThanIso: string,
): Promise<MemoryRecord[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("agent_memories")
    .select(
      "id, property_id, subject_kind, subject_id, kind, content, source, tags, importance, pinned, created_via, created_at",
    )
    .eq("property_id", scope.propertyId)
    .eq("subject_kind", scope.subjectKind)
    .eq("subject_id", scope.subjectId)
    .is("superseded_at", null)
    .eq("pinned", false)
    .eq("created_via", "agent")
    .contains("tags", ["auto"])
    .lt("created_at", olderThanIso)
    .order("created_at", { ascending: true })
    .limit(CONSOLIDATE_BATCH);
  return (data ?? []) as MemoryRecord[];
}

export async function consolidateScope(
  scope: MemoryScope,
): Promise<{ merged: number; dropped: number; considered: number }> {
  const olderThan = new Date(
    Date.now() - CONSOLIDATE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await autoMemoriesFor(scope, olderThan);
  if (rows.length < CONSOLIDATE_THRESHOLD || !process.env.ANTHROPIC_API_KEY) {
    return { merged: 0, dropped: 0, considered: rows.length };
  }
  const byShort = new Map(rows.map((r) => [shortId(r.id), r]));
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { output } = await generateText({
    model: anthropic(CONSOLIDATE_MODEL),
    instructions: MERGE_INSTRUCTIONS,
    prompt: rows
      .map((r) => `#${shortId(r.id)} [${r.kind} · ${r.created_at.slice(0, 10)}] ${r.content}`)
      .join("\n"),
    output: Output.object({ schema: Merge }),
    maxRetries: 1,
  });
  if (!output) return { merged: 0, dropped: 0, considered: rows.length };

  const store = memoryStore();
  const superseded = new Set<string>();
  let merged = 0;
  for (const entry of output.merged) {
    const sources = entry.replaces
      .map((id) => byShort.get(id.replace(/^#/, "")))
      .filter((r): r is MemoryRecord => Boolean(r));
    // The model may only replace memories it was actually shown.
    if (sources.length === 0 || !entry.content.trim()) continue;
    const saved = await store.remember({
      scope,
      content: entry.content.trim().slice(0, 2000),
      kind: entry.kind,
      source: `consolidated from ${sources.length} auto memories on ${new Date().toISOString().slice(0, 10)}`,
      tags: ["consolidated"],
      importance: 2,
      createdVia: "app",
    });
    if (saved.id) {
      for (const r of sources) superseded.add(r.id);
      merged += 1;
    }
  }
  let dropped = 0;
  for (const id of output.drop) {
    const row = byShort.get(id.replace(/^#/, ""));
    if (row && !superseded.has(row.id)) {
      superseded.add(row.id);
      dropped += 1;
    }
  }
  for (const id of superseded) await store.forget(scope, id);
  return { merged, dropped, considered: rows.length };
}

/** Every (subject_kind, subject_id) in the property that holds auto memories. */
export async function consolidateMemories(
  propertyId: string,
): Promise<{ scopes: number; merged: number; dropped: number }> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("agent_memories")
    .select("subject_kind, subject_id")
    .eq("property_id", propertyId)
    .is("superseded_at", null)
    .contains("tags", ["auto"])
    .limit(2000);
  const scopes = new Map<string, MemoryScope>();
  for (const r of data ?? []) {
    scopes.set(`${r.subject_kind}:${r.subject_id}`, {
      propertyId,
      subjectKind: r.subject_kind as MemorySubjectKind,
      subjectId: r.subject_id,
    });
  }
  let merged = 0;
  let dropped = 0;
  for (const scope of scopes.values()) {
    const result = await consolidateScope(scope);
    merged += result.merged;
    dropped += result.dropped;
  }
  return { scopes: scopes.size, merged, dropped };
}
