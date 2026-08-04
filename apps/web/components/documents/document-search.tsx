"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { FileText, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";

const DEBOUNCE_MS = 200;
const MIN_QUERY_CHARS = 2;

type Hit = {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  rank: number;
};

/**
 * Keyword search across a property's active documents — input + result list.
 * Powered by `search_documents_keyword` (migration 0019) over the `body_fts`
 * generated tsvector. Results stream as the user types: 200ms debounce, 2-char
 * minimum, `keepPreviousData` so the list doesn't flash blank between strokes.
 *
 * No semantic search here yet; the snapshot pipeline already writes the data
 * a future `hybrid_search()` RPC would consume (body_text → embedding), so
 * upgrading to hybrid is additive — this component swaps its endpoint.
 */
export function DocumentSearch({ propertyId }: { propertyId: string }) {
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(raw.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [raw]);

  const enabled = debounced.length >= MIN_QUERY_CHARS;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["documents", propertyId, "search", debounced] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Hit[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/documents/search?q=${encodeURIComponent(debounced)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("search failed");
      const json = (await res.json()) as { results: Hit[] };
      return json.results;
    },
  });

  const hits = enabled ? (data ?? []) : [];
  const showResults = enabled;
  const empty = enabled && !isFetching && hits.length === 0 && !isError;

  // Pre-tokenize the query for `<mark>`-style highlighting in previews. We
  // don't try to match Postgres' `websearch_to_tsquery` semantics exactly —
  // just lowercase, length>=2 tokens, regex-escape — which catches the words
  // a user would expect to see emphasized.
  const queryTokens = useMemo(() => {
    return Array.from(
      new Set(
        debounced
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length >= 2)
          .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      ),
    );
  }, [debounced]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint-foreground"
        />
        <Input
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Search documents…"
          aria-label="Search documents"
          className="h-9 pr-9 pl-9"
        />
        {raw ? (
          <button
            type="button"
            onClick={() => setRaw("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-0.5 text-faint-foreground transition-colors hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {showResults ? (
        <div
          role="listbox"
          aria-label="Search results"
          className={cn(
            "flex flex-col overflow-hidden rounded-overlay bg-popover shadow-overlay",
            isFetching && "opacity-80",
          )}
        >
          {isError ? (
            <p className="px-3 py-2 text-sm text-destructive">
              Search failed. Try again.
            </p>
          ) : empty ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No documents match &ldquo;{debounced}&rdquo;.
            </p>
          ) : (
            <ul className="flex flex-col">
              {hits.map((hit, i) => (
                <li
                  key={hit.id}
                  role="option"
                  aria-selected={false}
                  className={cn(i > 0 && "border-t border-border")}
                >
                  <Link
                    href={documentHref(propertyId, hit.id)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      openDocument(hit.id);
                    }}
                    onMouseEnter={() => prewarm(hit.id)}
                    className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent"
                  >
                    <FileText
                      strokeWidth={1.5}
                      className="size-4 shrink-0 translate-y-0.5 text-faint-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {hit.title || "Untitled"}
                      </span>
                      {hit.preview ? (
                        <span className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                          {highlight(hit.preview, queryTokens)}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Visually emphasize matched tokens in a result preview. Pure presentation —
 * the actual ranking happens in Postgres via `ts_rank_cd`.
 */
function highlight(text: string, tokens: string[]): React.ReactNode {
  if (tokens.length === 0) return text;
  const pattern = new RegExp(`(${tokens.join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    pattern.test(part) ? (
      <mark key={i} className="bg-annotation-mark text-foreground">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
