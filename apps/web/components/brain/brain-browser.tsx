"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/eyebrow";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { BrainOverview as BrainOverviewData, BrainPageSummary } from "@/lib/brain/shared";
import { BrainPageDetail } from "./brain-page-detail";
import { BrainOverview } from "./brain-overview";

type SearchHit = {
  slug: string;
  title: string;
  type: string;
  chunk_text: string;
  chunk_source: string;
};

/**
 * The Brain browser — a master-detail view over the property's gbrain
 * source: searchable page index on the left, compiled truth + timeline
 * provenance (and the curation verbs) on the right.
 *
 * Everything goes through the member-gated /api/properties/:id/brain/*
 * proxies; the client never sees the brain URL or credentials.
 */
export function BrainBrowser({
  propertyId,
  configured,
  source,
  initialPages,
  overview,
  isOwner,
  canCurate,
  canArchive,
}: {
  propertyId: string;
  configured: boolean;
  source: string | null;
  initialPages: BrainPageSummary[] | null;
  overview: BrainOverviewData;
  isOwner: boolean;
  canCurate: boolean;
  canArchive: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("slug");
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Keep ?slug= shareable without a server round-trip per selection.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedSlug) url.searchParams.set("slug", selectedSlug);
    else url.searchParams.delete("slug");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [selectedSlug]);

  const pagesQuery = useQuery({
    queryKey: ["brain-pages", propertyId],
    queryFn: async (): Promise<BrainPageSummary[]> => {
      const res = await fetch(`/api/properties/${propertyId}/brain/pages`);
      if (!res.ok) throw new Error("failed to load pages");
      const body = (await res.json()) as {
        pages?: BrainPageSummary[];
        unavailable?: boolean;
      };
      if (body.unavailable || !body.pages) throw new Error("brain unavailable");
      return body.pages;
    },
    initialData: initialPages ?? undefined,
    enabled: configured,
    staleTime: 30_000,
  });

  const searching = debouncedQuery.length >= 2;
  const searchQuery = useQuery({
    queryKey: ["brain-search", propertyId, debouncedQuery],
    queryFn: async (): Promise<SearchHit[]> => {
      const res = await fetch(`/api/properties/${propertyId}/brain/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: debouncedQuery, limit: 10 }),
      });
      if (!res.ok) throw new Error("search failed");
      const body = (await res.json()) as { results?: SearchHit[] };
      return Array.isArray(body.results) ? body.results : [];
    },
    enabled: configured && searching,
    staleTime: 30_000,
  });

  // Group the index by namespace (the slug's first path segment) so the
  // brain's own organization — operations/, guests/, … — is the navigation.
  const groups = useMemo(() => {
    const pages = pagesQuery.data ?? [];
    const byNamespace = new Map<string, BrainPageSummary[]>();
    for (const page of pages) {
      const namespace = page.slug.includes("/")
        ? page.slug.slice(0, page.slug.indexOf("/"))
        : "general";
      const bucket = byNamespace.get(namespace);
      if (bucket) bucket.push(page);
      else byNamespace.set(namespace, [page]);
    }
    return [...byNamespace.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [pagesQuery.data]);

  if (!configured) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-6 py-4">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight">Brain</h1>
            <p className="truncate text-xs text-muted-foreground">
              Everything this property has learned — and where each fact came
              from
            </p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BrainOverview
            propertyId={propertyId}
            overview={overview}
            isOwner={isOwner}
            onSelectSlug={setSelectedSlug}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Brain</h1>
          <p className="truncate text-xs text-muted-foreground">
            Everything this property has learned — and where each fact came
            from
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge tone="success">Connected</StatusBadge>
          {source ? (
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              {source}
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div
          className={cn(
            "flex min-h-0 flex-col border-border/60 lg:border-r",
            selectedSlug && "max-lg:hidden",
          )}
        >
          <div className="relative p-3">
            <Search className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="brain-search"
              aria-label="Search the brain"
              placeholder="Search knowledge…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {searching ? (
              <SearchResults
                query={searchQuery}
                selectedSlug={selectedSlug}
                onSelect={setSelectedSlug}
              />
            ) : pagesQuery.isError ? (
              <p className="px-2 py-6 text-sm text-pretty text-muted-foreground">
                The brain didn&apos;t respond. It may be briefly unreachable —
                try again in a moment.
              </p>
            ) : groups.length === 0 ? (
              <p className="px-2 py-6 text-sm text-pretty text-muted-foreground">
                Nothing captured yet. Pages appear here as meetings are
                summarized, guests share details, and bots capture evidence.
              </p>
            ) : (
              <div className="flex flex-col gap-5 pt-1">
                {groups.map(([namespace, pages]) => (
                  <section key={namespace} className="flex flex-col gap-1">
                    <Eyebrow className="px-2">{namespace}</Eyebrow>
                    <ul role="list" className="flex flex-col">
                      {pages.map((page) => (
                        <li key={page.slug}>
                          <button
                            type="button"
                            onClick={() => setSelectedSlug(page.slug)}
                            className={cn(
                              "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
                              selectedSlug === page.slug
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                            )}
                          >
                            <span className="truncate text-sm font-medium">
                              {page.title}
                            </span>
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {page.slug}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>

          <p className="border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground tabular-nums">
            {pagesQuery.data?.length ?? 0} pages
          </p>
        </div>

        <div className={cn("min-h-0 overflow-y-auto", !selectedSlug && "max-lg:hidden")}>
          {selectedSlug ? (
            <BrainPageDetail
              propertyId={propertyId}
              slug={selectedSlug}
              canCurate={canCurate}
              canArchive={canArchive}
              onBack={() => setSelectedSlug(null)}
              onArchived={() => {
                setSelectedSlug(null);
                void pagesQuery.refetch();
              }}
            />
          ) : (
            <BrainOverview
              propertyId={propertyId}
              overview={overview}
              isOwner={isOwner}
              onSelectSlug={setSelectedSlug}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SearchResults({
  query,
  selectedSlug,
  onSelect,
}: {
  query: {
    data?: SearchHit[];
    isPending: boolean;
    isError: boolean;
  };
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  if (query.isPending) {
    return <p className="px-2 py-6 text-sm text-muted-foreground">Searching…</p>;
  }
  if (query.isError) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        Search failed — try again.
      </p>
    );
  }
  const hits = query.data ?? [];
  if (hits.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-pretty text-muted-foreground">
        No matches. The brain only knows what&apos;s been captured — an empty
        result usually means the fact was never recorded.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col gap-1 pt-1">
      {hits.map((hit, i) => (
        <li key={`${hit.slug}-${i}`}>
          <button
            type="button"
            onClick={() => onSelect(hit.slug)}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
              selectedSlug === hit.slug
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span className="truncate text-sm font-medium">{hit.title}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {hit.chunk_text}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground/70">
              {hit.slug}
              {hit.chunk_source === "timeline" ? " · timeline" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
