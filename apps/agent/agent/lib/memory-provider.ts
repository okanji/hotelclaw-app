/**
 * The eve memory PROVIDER behind agent/memory/property.ts and person.ts —
 * eve's `defineMemoryProvider` contract over the app's Postgres
 * (`@hotelclaw/memory` owns the store; this file owns the lifecycle glue).
 *
 * What eve does with it, per turn (docs/memory/custom-provider):
 *   1. resolves + LOCKS the slot's scope from verified session auth
 *      (agent/memory/<slot>.ts) — the model never supplies a scope;
 *   2. calls `recall["turn.started"]` and injects the result as an
 *      attributed user-role message before the model runs;
 *   3. mounts `tools()` as `<slot>__remember / __forget / __search`;
 *   4. after compaction, calls `recall["compaction.completed"]` so the
 *      core facts survive the summary;
 *   5. after each successful turn, calls `capture["turn.completed"]` — the
 *      PROPERTY slot runs auto-capture there (lib/auto-capture.ts), writing
 *      to both the property and the person scope so the agent learns even
 *      when the model forgot to call `remember`. Only one slot captures so
 *      a turn costs one extraction, not one per slot.
 *
 * eve constraints honoured here: tool callbacks are INLINE arrows closing
 * over PLAIN STRINGS only (the build transform serialises captured values;
 * objects/functions don't replay), and recall messages carry STABLE ids so
 * each turn's recall supersedes the last instead of accumulating.
 */
import { defineMemoryProvider } from "eve/memory";
import { defineTool } from "eve/tools";
import {
  MEMORY_LIMITS,
  createMemoryStore,
  formatRecall,
  memoryCitation,
  memoryToolDescriptions,
  memoryToolSchemas,
  recallQueryFromInput,
  shortMemoryId,
  type MemoryScope,
  type MemorySubjectKind,
} from "@hotelclaw/memory";
import { serviceClient } from "./supabase";
import { autoCapture } from "./auto-capture";

export function memoryStore() {
  return createMemoryStore(serviceClient());
}

/** The slot's locked scope value, as the scope resolver returned it:
 * `[propertyId]` for the property slot, `[propertyId, userId]` for person. */
function scopeFromValue(
  value: unknown,
  subjectKind: MemorySubjectKind,
): MemoryScope | null {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const propertyId = typeof parts[0] === "string" ? parts[0] : null;
  if (!propertyId) return null;
  if (subjectKind === "property") {
    return { propertyId, subjectKind, subjectId: propertyId };
  }
  const subjectId = typeof parts[1] === "string" ? parts[1] : null;
  return subjectId ? { propertyId, subjectKind, subjectId } : null;
}

const SLOT_TITLES: Record<MemorySubjectKind, string> = {
  property: "Property memory",
  user: "Your notes about this person",
  guest: "Guest memory",
};

export function hotelclawMemory(subjectKind: MemorySubjectKind) {
  return defineMemoryProvider({
    recall: {
      async "turn.started"(ctx) {
        const scope = scopeFromValue(ctx.memory.scope.value, subjectKind);
        if (!scope) return null;
        const store = memoryStore();
        const query = recallQueryFromInput(ctx.turn?.input);
        const [pinned, hits] = await Promise.all([
          store.pinned(scope, MEMORY_LIMITS.recallPinned),
          query.length >= 2 ? store.search(scope, query, MEMORY_LIMITS.recallSearch) : [],
        ]);
        const text = formatRecall({
          slot: ctx.memory.slot,
          title: SLOT_TITLES[subjectKind],
          pinned,
          hits,
        });
        if (!text) return null;
        // ONE message with a stable id: the next turn's recall replaces it
        // (eve supersedes by id) rather than stacking a block per turn.
        return { messages: [{ id: `${ctx.memory.slot}:recall`, content: text }] };
      },
      // After a compaction the checkpoint replaced history — put the core
      // facts back; the next turn's recall brings relevance hits again.
      async "compaction.completed"(ctx) {
        const scope = scopeFromValue(ctx.memory.scope.value, subjectKind);
        if (!scope) return null;
        const pinned = await memoryStore().pinned(scope, MEMORY_LIMITS.recallPinned);
        const text = formatRecall({
          slot: ctx.memory.slot,
          title: SLOT_TITLES[subjectKind],
          pinned,
          hits: [],
        });
        return text ? { messages: [{ id: `${ctx.memory.slot}:recall`, content: text }] } : null;
      },
    },
    capture:
      subjectKind === "property"
        ? {
            async "turn.completed"(ctx) {
              const property = scopeFromValue(ctx.memory.scope.value, "property");
              if (!property) return;
              const attrs = ctx.session.auth.current?.attributes ?? {};
              const personId =
                (typeof attrs.senderId === "string" && attrs.senderId) ||
                ctx.session.auth.current?.principalId ||
                null;
              const person = personId
                ? { propertyId: property.propertyId, subjectKind: "user" as const, subjectId: personId }
                : null;
              try {
                const result = await autoCapture({
                  store: memoryStore(),
                  property,
                  person,
                  messages: ctx.messages,
                  operationId: ctx.operationId,
                  authorId: ctx.session.auth.current?.principalId ?? null,
                });
                if (result.written > 0) {
                  console.log(`[auto-capture] ${result.written} memories for ${property.propertyId}`);
                }
              } catch (err) {
                console.warn("[auto-capture] skipped", err);
              }
            },
          }
        : undefined,
    async tools(ctx) {
      const scope = scopeFromValue(ctx.memory.scope.value, subjectKind);
      if (!scope) return null;
      // Plain-string captures only (eve build transform).
      const memPropertyId = scope.propertyId;
      const memSubjectKind = scope.subjectKind;
      const memSubjectId = scope.subjectId;
      const memAuthor = ctx.session.auth.current?.principalId ?? null;

      return {
        remember: defineTool({
          description: memoryToolDescriptions.remember,
          inputSchema: memoryToolSchemas.remember,
          async execute({ content, kind, source, tags, pinned }) {
            const saved = await memoryStore().remember({
              scope: {
                propertyId: memPropertyId,
                subjectKind: memSubjectKind as MemorySubjectKind,
                subjectId: memSubjectId,
              },
              content,
              kind,
              source: source ?? null,
              tags,
              pinned,
              createdBy: memAuthor,
              createdVia: "agent",
            });
            return {
              saved: true,
              duplicate: saved.duplicate,
              memory_id: shortMemoryId(saved.id),
              cite_as: memoryCitation(saved.id),
            };
          },
        }),
        forget: defineTool({
          description: memoryToolDescriptions.forget,
          inputSchema: memoryToolSchemas.forget,
          async execute({ memory_id }) {
            const store = memoryStore();
            const scopeNow = {
              propertyId: memPropertyId,
              subjectKind: memSubjectKind as MemorySubjectKind,
              subjectId: memSubjectId,
            };
            const row = await store.resolveId(scopeNow, memory_id);
            if (!row) return { forgotten: false, reason: `No memory #${memory_id} in this scope.` };
            const ok = await store.forget(scopeNow, row.id);
            return { forgotten: ok, memory_id: shortMemoryId(row.id), content: row.content };
          },
        }),
        search: defineTool({
          description: memoryToolDescriptions.search,
          inputSchema: memoryToolSchemas.search,
          async execute({ query, limit }) {
            const rows = await memoryStore().search(
              {
                propertyId: memPropertyId,
                subjectKind: memSubjectKind as MemorySubjectKind,
                subjectId: memSubjectId,
              },
              query,
              limit,
            );
            return {
              count: rows.length,
              memories: rows.map((r) => ({
                memory_id: shortMemoryId(r.id),
                kind: r.kind,
                pinned: r.pinned,
                date: r.created_at.slice(0, 10),
                content: r.content,
                source: r.source,
                cite_as: memoryCitation(r.id),
              })),
            };
          },
        }),
      };
    },
  });
}
