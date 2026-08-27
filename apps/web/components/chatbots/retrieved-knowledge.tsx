"use client";

import { FileText, SearchX } from "lucide-react";

/**
 * "Retrieved knowledge" block for the sandbox test console — the chunks
 * search_knowledge actually returned for a turn, as compact cards with a
 * staggered entrance, so staff can see WHAT the bot grounded its answer on.
 * When the search ran and matched nothing, a quiet one-liner says so — the
 * key debugging signal (the bot is answering without sources).
 *
 * Adapted from the Beautiful UI ContextCards pattern, re-mapped onto the
 * house tokens. Only the test route returns tool outputs, so this renders
 * nothing on surfaces without them (e.g. the staff transcript).
 */

type KnowledgeHit = { source: string; content: string };

/** Pull search_knowledge results out of a turn's tool calls. */
function extractKnowledge(
  toolCalls: { name: string; output?: unknown }[],
): { searched: boolean; hits: KnowledgeHit[] } {
  let searched = false;
  const hits: KnowledgeHit[] = [];
  for (const call of toolCalls) {
    if (call.name !== "search_knowledge") continue;
    if (typeof call.output !== "object" || call.output === null) continue;
    const results = (call.output as { results?: unknown }).results;
    if (!Array.isArray(results)) continue;
    searched = true;
    for (const r of results) {
      if (typeof r !== "object" || r === null) continue;
      const { source, content } = r as { source?: unknown; content?: unknown };
      if (typeof content !== "string" || !content) continue;
      hits.push({
        source: typeof source === "string" && source ? source : "Knowledge source",
        content,
      });
    }
  }
  return { searched, hits };
}

export function RetrievedKnowledge({
  toolCalls,
}: {
  toolCalls?: { name: string; output?: unknown }[];
}) {
  if (!toolCalls || toolCalls.length === 0) return null;
  const { searched, hits } = extractKnowledge(toolCalls);
  if (!searched) return null;

  if (hits.length === 0) {
    return (
      <p className="ai-fade-up flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
        <SearchX className="size-3 shrink-0" />
        No knowledge matched — the bot answered without sources.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="ai-fade-up flex items-center gap-1.5 px-0.5 text-xs font-medium text-faint-foreground">
        Retrieved knowledge
        <span className="rounded-md bg-muted px-1.5 py-px font-mono text-[11px] tabular-nums">
          {hits.length}
        </span>
      </p>
      {hits.map((hit, i) => (
        <div
          key={i}
          className="ai-fade-up overflow-hidden rounded-card bg-card shadow-card"
          style={{ animationDelay: `${i * 90}ms` }}
        >
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
            <FileText className="size-3 shrink-0 text-faint-foreground" />
            <span className="min-w-0 truncate text-xs font-medium text-foreground">
              {hit.source}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-faint-foreground tabular-nums">
              {hit.content.length.toLocaleString()} chars
            </span>
          </div>
          <p className="line-clamp-3 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
            {hit.content}
          </p>
        </div>
      ))}
    </div>
  );
}
