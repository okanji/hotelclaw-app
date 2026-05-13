"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChatContext } from "stream-chat-react";
import { Search, X } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SearchHeader } from "./search-header";
import { SearchResultCard } from "./search-result-card";
import {
  parseSearchParams,
  stringifySearchState,
  type SearchState,
} from "./parse-search-params";
import { useMessageSearch } from "./use-message-search";

type Props = {
  propertyId: string;
};

export function SearchPageClient({ propertyId }: Props) {
  const router = useRouter();
  const urlParams = useSearchParams();
  const { client } = useChatContext();

  // Snapshot URL state. Source of truth for everything except the draft query
  // (we debounce keystrokes so we don't push a new entry on every character).
  const urlState = useMemo<SearchState>(
    () => parseSearchParams(urlParams ?? new URLSearchParams()),
    [urlParams],
  );

  const [draftQuery, setDraftQuery] = useState(urlState.q);
  // Keep draft in sync if the URL is changed externally (e.g. clicking a chip
  // that doesn't touch `q`). We compare against `urlState.q` and only adopt
  // when they differ AND the user is not actively typing — heuristic: adopt
  // if our debounced value also matches the URL, meaning we're "settled".
  const debouncedDraft = useDebouncedValue(draftQuery, 300);

  useEffect(() => {
    if (urlState.q !== draftQuery && urlState.q !== debouncedDraft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftQuery(urlState.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlState.q]);

  // Push debounced query into the URL.
  const lastPushedRef = useRef<string>(stringifySearchState(urlState));
  useEffect(() => {
    if (debouncedDraft === urlState.q) return;
    const next: SearchState = { ...urlState, q: debouncedDraft };
    const qs = stringifySearchState(next);
    if (qs === lastPushedRef.current) return;
    lastPushedRef.current = qs;
    router.replace(`/p/${propertyId}/search${qs}`, { scroll: false });
  }, [debouncedDraft, urlState, router, propertyId]);

  const patchState = useCallback(
    (patch: Partial<SearchState>) => {
      const next: SearchState = { ...urlState, ...patch };
      const qs = stringifySearchState(next);
      lastPushedRef.current = qs;
      router.replace(`/p/${propertyId}/search${qs}`, { scroll: false });
    },
    [urlState, router, propertyId],
  );

  // Exit search: prefer going back to wherever the user came from (the channel
  // they were viewing, the page that opened Cmd+K, etc.). When there's no
  // history (deep link / fresh tab), fall back to the chat root.
  const exit = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(`/p/${propertyId}/chat`);
    }
  }, [router, propertyId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Don't hijack Escape when a popover/menu is open or when the user is
      // mid-edit in a chip picker — those handle their own dismissal first.
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-slot='popover-content']")) return;
      e.preventDefault();
      exit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exit]);

  // Effective state used for searching reflects the *debounced* query, not the
  // raw draft, so we don't fire a Stream request on every keystroke.
  const effectiveState = useMemo<SearchState>(
    () => ({ ...urlState, q: debouncedDraft }),
    [urlState, debouncedDraft],
  );

  const trimmed = effectiveState.q.trim();
  const ready = trimmed.length >= 2 && !!client;

  const search = useMessageSearch({
    propertyId,
    state: effectiveState,
    enabled: ready,
  });

  const allHits = useMemo(
    () => (search.data?.pages ?? []).flatMap((p) => p.hits),
    [search.data],
  );

  const resultCountLabel = useMemo<string | null>(() => {
    if (!ready) return null;
    if (search.isLoading) return "Searching…";
    if (search.isError) return null;
    const visible = allHits.length;
    return search.hasNextPage
      ? `${visible}+ result${visible === 1 ? "" : "s"}`
      : `${visible} result${visible === 1 ? "" : "s"}`;
  }, [ready, search.isLoading, search.isError, search.hasNextPage, allHits.length]);

  // Infinite scroll sentinel.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = search;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!client) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <PageHeader
        title="Search"
        icon={<Search />}
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={exit}
            title="Exit search (Esc)"
            aria-label="Exit search"
          >
            <X />
          </Button>
        }
      />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Connecting to chat…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title="Search"
        icon={<Search />}
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={exit}
            title="Exit search (Esc)"
            aria-label="Exit search"
          >
            <X />
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SearchHeader
          propertyId={propertyId}
          state={urlState}
          draftQuery={draftQuery}
          onDraftChange={setDraftQuery}
          onChange={patchState}
          resultCountLabel={resultCountLabel}
        />
        {!ready ? (
          <Prompt
            title="Type to search"
            body="Enter at least 2 characters to search messages across channels and DMs you’re a member of."
          />
        ) : search.isError ? (
          <Prompt
            title="Search failed"
            body={search.error?.message ?? "Something went wrong while searching."}
            action={
              <Button size="sm" onClick={() => void search.refetch()}>
                Try again
              </Button>
            }
          />
        ) : search.isLoading ? (
          <ul className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i}>
                <SkeletonCard />
              </li>
            ))}
          </ul>
        ) : allHits.length === 0 ? (
          <Prompt
            title={`No results for “${trimmed}”`}
            body="Try removing filters, broadening the date range, or searching for a different term."
          />
        ) : (
          <div className="flex flex-col gap-3 p-4">
            <ul className="flex flex-col gap-2">
              {allHits.map((hit) => (
                <SearchResultCard
                  key={`${hit.message.cid}:${hit.message.id}`}
                  propertyId={propertyId}
                  message={hit.message}
                  channelId={hit.channelId}
                  query={trimmed}
                />
              ))}
            </ul>
            {search.hasNextPage ? (
              <div ref={sentinelRef} className="flex justify-center py-3">
                {search.isFetchingNextPage ? (
                  <span className="text-xs text-muted-foreground">
                    Loading more…
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void search.fetchNextPage()}
                  >
                    Load more
                  </Button>
                )}
              </div>
            ) : (
              <div className="py-3 text-center text-xs text-muted-foreground">
                End of results
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function Prompt({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Search className="size-5" />
      </div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="max-w-sm text-xs text-muted-foreground">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex gap-3 rounded-md border bg-card p-3">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}
