import "server-only";
/**
 * Web-side handle on property memory (`@hotelclaw/memory` over the service
 * client). The SAME store implementation the eve runtime uses — one place
 * for the SQL, two callers.
 *
 * Service role on purpose: every caller here is server code that has
 * already verified the property (route membership check, webhook signature,
 * or a workflow's own tenancy) and partitions by an explicit MemoryScope.
 * Members READ via RLS in the UI; nothing in the browser writes memory.
 */
import {
  createMemoryStore,
  propertyScope,
  shortMemoryId,
  type MemoryStore,
} from "@hotelclaw/memory";
import { createServiceClient } from "@/lib/supabase/server";

let cached: MemoryStore | null = null;

export function memoryStore(): MemoryStore {
  if (!cached) cached = createMemoryStore(createServiceClient());
  return cached;
}

export {
  guestScope,
  memoryCitation,
  propertyScope,
  shortMemoryId,
  userScope,
  type MemoryRecord,
  type MemoryScope,
} from "@hotelclaw/memory";

/**
 * Deterministic app writers call this: meeting outcomes, accepted triage
 * routings, workflow capture steps. Fail-soft — a memory write must never
 * fail the operation that produced the fact. Returns the row id or null.
 */
export async function rememberForProperty(input: {
  propertyId: string;
  content: string;
  kind?: "fact" | "preference" | "event" | "outcome" | "playbook";
  source?: string;
  tags?: string[];
  importance?: 1 | 2 | 3;
  createdBy?: string | null;
}): Promise<string | null> {
  try {
    const saved = await memoryStore().remember({
      scope: propertyScope(input.propertyId),
      content: input.content,
      kind: input.kind ?? "event",
      source: input.source ?? null,
      tags: input.tags,
      importance: input.importance ?? 2,
      createdBy: input.createdBy ?? null,
      createdVia: "app",
    });
    return saved.id;
  } catch (err) {
    console.warn("[memory] app write skipped", { propertyId: input.propertyId }, err);
    return null;
  }
}

/** Prefetch a compact memory context for single-shot bots and prompts
 * (triage evidence, automation suggestions). Returns rendered lines. */
export async function memoryContextLines(
  propertyId: string,
  query: string,
  limit = 6,
): Promise<string[]> {
  try {
    const store = memoryStore();
    const scope = propertyScope(propertyId);
    const [pinned, hits] = await Promise.all([
      store.pinned(scope, 6),
      query.trim().length >= 2 ? store.search(scope, query, limit) : Promise.resolve([]),
    ]);
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const row of [...pinned, ...hits]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      lines.push(
        `- [memory #${shortMemoryId(row.id)} · ${row.kind} · ${row.created_at.slice(0, 10)}] ${row.content}${row.source ? ` (source: ${row.source})` : ""}`,
      );
    }
    return lines;
  } catch (err) {
    console.warn("[memory] context prefetch failed", { propertyId }, err);
    return [];
  }
}
