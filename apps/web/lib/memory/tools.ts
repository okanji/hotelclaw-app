import "server-only";
/**
 * Property-memory tools for Tier-1 bots (`runBot()` — task/doc/insights
 * panels, Liveblocks comments, workflow AI steps). Same words and schemas
 * as the eve runtime's memory slot (`@hotelclaw/memory`), named
 * `property__search` / `property__remember` / `property__forget` so a
 * capability a user saw the channel bot use reads the same in a panel.
 *
 * Unlike the eve path there is no automatic per-turn recall here (these
 * bots are stateless single turns) — callers that want memory in the
 * prompt prefetch it with `memoryContextLines()`.
 */
import { tool, type ToolSet } from "ai";
import {
  memoryCitation,
  memoryToolDescriptions,
  memoryToolSchemas,
  propertyScope,
  shortMemoryId,
} from "@hotelclaw/memory";
import type { BotScope } from "@/lib/ai/run-bot";
import { memoryStore } from "@/lib/memory/store";

export function buildMemoryTools(scope: BotScope): ToolSet {
  const memScope = propertyScope(scope.propertyId);
  return {
    property__search: tool({
      description: memoryToolDescriptions.search,
      inputSchema: memoryToolSchemas.search,
      async execute({ query, limit }) {
        const rows = await memoryStore().search(memScope, query, limit);
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
    property__remember: tool({
      description: memoryToolDescriptions.remember,
      inputSchema: memoryToolSchemas.remember,
      async execute({ content, kind, source, tags, pinned }) {
        const saved = await memoryStore().remember({
          scope: memScope,
          content,
          kind,
          source: source ?? null,
          tags,
          pinned,
          createdBy: scope.userId ?? null,
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
    property__forget: tool({
      description: memoryToolDescriptions.forget,
      inputSchema: memoryToolSchemas.forget,
      async execute({ memory_id }) {
        const store = memoryStore();
        const row = await store.resolveId(memScope, memory_id);
        if (!row) return { forgotten: false, reason: `No memory #${memory_id} in this property.` };
        const ok = await store.forget(memScope, row.id);
        return { forgotten: ok, memory_id: shortMemoryId(row.id), content: row.content };
      },
    }),
  };
}
