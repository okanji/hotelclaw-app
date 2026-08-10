"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { FileText, GripVertical, Search, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/ui/eyebrow";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import {
  documentBoardsQueryOptions,
  documentsQueryOptions,
  documentsTreeQueryOptions,
} from "@/lib/query/section-queries";
import type { DocumentListItem } from "@/lib/documents/queries";
import { QuickCreateRow } from "./quick-create-row";
import { GenerateDocumentDialog } from "./generate-document-dialog";
import { DocBoardsSection } from "./doc-boards-section";
import { DocBoardsBoard } from "./doc-boards-board";
import { DocsActivitySheet } from "./docs-activity-panel";
import { useDocsHomePresence } from "./docs-home-presence";
import {
  DEFAULT_DIRECTORY_VIEW,
  DirectoryToolbar,
  type DirectorySort,
  type DirectoryView,
  type TeamOption,
} from "./directory-toolbar";
import { DocumentViewerAvatarStack } from "@/components/documents/document-presence-stack";
import { useMemberName } from "@/lib/documents/use-member-name";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY_CHARS = 2;
const PREVIEW_CHARS = 160;

/**
 * Documents section home — the Directory.
 *
 * **One list, one toolbar.** The page used to render the library three times:
 * a "Recently edited" section (the first six rows), an "All documents" section
 * (the same rows again, plus the rest), and the sidebar tree already on screen
 * beside both. On a small property "Recently edited" was an exact prefix of
 * "All documents" — the identical six titles, in the identical order, 300px
 * apart. Recency is the DEFAULT SORT and the Today/This week group headers
 * already carry that read, so the duplicate section is gone rather than
 * deduplicated: there is now exactly one list, and the toolbar above it decides
 * what that list contains.
 *
 * `DocBoardsBoard` provides the shared `DocsHomePresenceProvider` + `DndContext`
 * so a row drag can land on a board (pin) or be dropped back on the list
 * (unpin) — the same shell the property Home surface uses.
 */
export function DocumentsHome({ propertyId }: { propertyId: string }) {
  const [generateOpen, setGenerateOpen] = useState(false);
  return (
    <DocBoardsBoard propertyId={propertyId}>
      <Directory
        propertyId={propertyId}
        onGenerate={() => setGenerateOpen(true)}
      />
      <GenerateDocumentDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        propertyId={propertyId}
      />
    </DocBoardsBoard>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  The row model — one shape, whether it came from the list or from search   */
/* ────────────────────────────────────────────────────────────────────────── */

type DirectoryRow = {
  id: string;
  title: string;
  kind: "doc" | "sheet";
  updated_at: string;
  created_at: string | null;
  /** One-line body snippet: the server's search excerpt, or `body_text`. */
  preview: string;
  last_edited_by: string | null;
  space_id: string | null;
};

type SearchHit = {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  rank: number;
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Directory                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function Directory({
  propertyId,
  onGenerate,
}: {
  propertyId: string;
  onGenerate: () => void;
}) {
  const {
    data: docs,
    isPending,
    isError: docsError,
  } = useQuery(documentsQueryOptions(propertyId));
  const { data: boards = [] } = useQuery(documentBoardsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  // The tree is already warm (the section layout prefetches it for the sidebar)
  // and carries `kind` for EVERY document, not just the 50 the list query
  // returns — so a search hit from deep in the library still gets its icon.
  const { data: tree = [] } = useQuery(documentsTreeQueryOptions(propertyId));

  const [view, setView] = useState<DirectoryView>(DEFAULT_DIRECTORY_VIEW);
  const patchView = (next: Partial<DirectoryView>) =>
    setView((v) => ({ ...v, ...next }));

  const docsList = useMemo(() => docs ?? [], [docs]);
  const kindById = useMemo(
    () => new Map(tree.map((t) => [t.id, t.kind])),
    [tree],
  );

  /* ---- search: instant local title match, upgraded by server FTS -------- */

  const trimmed = view.query.trim();
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [trimmed]);

  const searching = trimmed.length >= MIN_QUERY_CHARS;
  const { data: hits, isFetching: searchFetching } = useQuery({
    queryKey: ["documents", propertyId, "search", debounced] as const,
    enabled: debounced.length >= MIN_QUERY_CHARS,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SearchHit[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/documents/search?q=${encodeURIComponent(debounced)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("search failed");
      return ((await res.json()) as { results: SearchHit[] }).results;
    },
  });

  /* ---- the rows -------------------------------------------------------- */

  const rows = useMemo<DirectoryRow[]>(() => {
    const fromDoc = (d: DocumentListItem): DirectoryRow => ({
      id: d.id,
      title: d.title,
      kind: kindById.get(d.id) ?? d.kind ?? "doc",
      updated_at: d.updated_at,
      created_at: d.created_at,
      preview: snippet(d.body_text),
      last_edited_by: d.last_edited_by,
      space_id: d.space_id,
    });

    if (!searching) return docsList.map(fromDoc);

    const byId = new Map(docsList.map((d) => [d.id, d]));
    const needle = trimmed.toLowerCase();
    // Title matches render on the first keystroke; the ranked full-text hits
    // (title AND body) replace them the moment the request lands. Without the
    // local pass, every search flashed an empty list for ~250ms.
    const local = docsList
      .filter((d) => (d.title || "Untitled").toLowerCase().includes(needle))
      .map(fromDoc);

    const serverRows = (hits ?? []).map((h): DirectoryRow => {
      const d = byId.get(h.id);
      return {
        id: h.id,
        title: h.title,
        kind: kindById.get(h.id) ?? d?.kind ?? "doc",
        updated_at: h.updated_at,
        created_at: d?.created_at ?? null,
        preview: h.preview || snippet(d?.body_text ?? ""),
        last_edited_by: d?.last_edited_by ?? null,
        space_id: d?.space_id ?? null,
      };
    });
    if (serverRows.length === 0) return local;

    const seen = new Set(serverRows.map((r) => r.id));
    return [...serverRows, ...local.filter((r) => !seen.has(r.id))];
  }, [searching, docsList, hits, kindById, trimmed]);

  const shown = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (view.kind === "all" || r.kind === view.kind) &&
        (view.team === "all" ||
          (view.team === "general" ? !r.space_id : r.space_id === view.team)),
    );
    // Search results keep the server's relevance order; a browse list gets the
    // sort the user picked.
    if (searching) return filtered;
    return sortRows(filtered, view.sort);
  }, [rows, view.kind, view.team, view.sort, searching]);

  const groups = useMemo(
    () => groupRows(shown, searching ? null : view.sort),
    [shown, view.sort, searching],
  );

  /* ---- toolbar inputs -------------------------------------------------- */

  const teams = useMemo<TeamOption[]>(
    () =>
      spaces
        .map((s) => ({
          id: s.id,
          name: s.name,
          icon: s.icon,
          count: docsList.filter((d) => d.space_id === s.id).length,
        }))
        .filter((t) => t.count > 0),
    [spaces, docsList],
  );
  const generalCount = useMemo(
    () => docsList.filter((d) => !d.space_id).length,
    [docsList],
  );
  const editsThisWeek = useMemo(() => {
    const cutoff = Date.now() - ONE_WEEK_MS;
    return docsList.filter((d) => new Date(d.updated_at).getTime() >= cutoff)
      .length;
  }, [docsList]);

  const queryTokens = useMemo(
    () => (searching ? tokenize(trimmed) : []),
    [searching, trimmed],
  );

  const isEmptyProperty = !isPending && docsList.length === 0;

  return (
    // The masthead owns the top gutter, NOT this scroller: a sticky child's
    // offset is measured from the scroll container's CONTENT box, so a `pt-12`
    // here would park the toolbar 48px down the pane and let rows scroll
    // through the gap above it (measured).
    <div className="flex h-full w-full flex-col overflow-y-auto px-8 pb-16 sm:px-14">
      {/* ONE width for the whole Directory: `PageShell` owns it, and every
          element from the masthead to the last row shares its edge. */}
      <PageShell className="flex flex-col">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 pt-12">
          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="text-[2.5rem] leading-[3rem] font-bold text-balance text-foreground">
              Directory
            </h1>
            {/* Whitespace-separated stat one-liner — the same shape the Home
                widgets use. Stats never get rules (DESIGN.md). */}
            <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
              <Stat label="In the library" value={docsList.length} />
              <Stat label="On boards" value={boards.length} />
              <Stat label="Edits this week" value={editsThisWeek} />
            </dl>
          </div>
          <DocsActivitySheet propertyId={propertyId} />
        </header>

        {isEmptyProperty ? (
          <EmptyDirectory propertyId={propertyId} onGenerate={onGenerate} />
        ) : (
          <>
            <DirectoryToolbar
              propertyId={propertyId}
              view={view}
              onChange={patchView}
              teams={teams}
              generalCount={generalCount}
              onGenerate={onGenerate}
              resultCount={searching ? shown.length : null}
            />

            {docsError ? (
              <p className="mb-6 text-sm text-destructive">
                Could not load documents. Try refreshing the page.
              </p>
            ) : null}

            {/* Boards are a curated shelf, not a search surface — while the
                user is looking for something specific they're just noise. */}
            {searching ? null : (
              <div className="mb-10">
                <DocBoardsSection propertyId={propertyId} />
              </div>
            )}

            <UnpinZone id="unpin-zone:directory" className="rounded-md">
              {isPending ? (
                <ListSkeleton />
              ) : shown.length === 0 ? (
                <NoMatches
                  searching={searching}
                  fetching={searchFetching}
                  onReset={() =>
                    patchView({ query: "", kind: "all", team: "all" })
                  }
                />
              ) : (
                <div className="flex flex-col gap-8">
                  {groups.map((g) => (
                    <section key={g.label ?? "_all"}>
                      {g.label ? (
                        <div className="mb-1 flex items-baseline justify-between gap-3 px-2">
                          <Eyebrow>{g.label}</Eyebrow>
                          <span className="text-xs text-faint-foreground tabular-nums">
                            {g.items.length}
                          </span>
                        </div>
                      ) : null}
                      <ul role="list" className="flex flex-col">
                        {g.items.map((r) => (
                          <DocumentRow
                            key={r.id}
                            propertyId={propertyId}
                            row={r}
                            tokens={queryTokens}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </UnpinZone>
          </>
        )}
      </PageShell>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Row                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

function DocumentRow({
  propertyId,
  row,
  tokens,
}: {
  propertyId: string;
  row: DirectoryRow;
  tokens: string[];
}) {
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);
  const viewers = useDocsHomePresence(row.id);
  const editorName = useMemberName(propertyId, row.last_edited_by);

  // Per-instance id: dnd-kit keys drag state by id, and a doc can appear in
  // more than one list on the page. The real document is resolved from
  // `data.documentId` in the DnD handlers.
  const instanceId = useId();
  // Destructured, not held as `drag.*`: reading ref-bearing members off the
  // hook's result object during render trips `react-hooks/refs`, while the
  // destructured callback ref and state values are fine (the same shape
  // `components/tasks/task-card.tsx` uses).
  const { setNodeRef, attributes, listeners, transform, isDragging } =
    useDraggable({
      id: `doc:${instanceId}`,
      data: { type: "doc", documentId: row.id },
    });

  const Icon = row.kind === "sheet" ? Table2 : FileText;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(row.id);
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("group/row relative", isDragging && "opacity-40")}
    >
      <Link
        href={documentHref(propertyId, row.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(row.id)}
        draggable={false}
        className="flex min-h-[37px] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
      >
        {/* The type icon IS the row's left edge — a list where every row leads
            with an identical drag grip has no scannable edge at all, and a
            spreadsheet becomes indistinguishable from a document. The grip
            takes the icon's place on hover, so dragging still works without
            costing the list its texture. */}
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          <Icon
            strokeWidth={1.5}
            aria-hidden="true"
            className="size-4 text-faint-foreground transition-opacity group-hover/row:opacity-0"
          />
          <span
            {...attributes}
            {...listeners}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            aria-label="Drag to pin to a board"
            className="absolute -inset-1 flex cursor-grab items-center justify-center text-faint-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="size-4" />
          </span>
        </span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground lg:w-72 lg:flex-none">
          {row.title || "Untitled"}
        </span>

        {/* `body_text` is already on every row (the board cards use it) — the
            list used to fetch it and throw it away, leaving a column of
            identical "Untitled document" rows with nothing to tell them
            apart. */}
        <span className="hidden min-w-0 flex-1 truncate text-sm text-faint-foreground lg:block">
          {row.preview ? highlight(row.preview, tokens) : null}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-3">
          <DocumentViewerAvatarStack users={viewers} size={18} />
          {editorName ? (
            <span className="hidden truncate text-xs text-faint-foreground sm:inline">
              {editorName}
            </span>
          ) : null}
          <span className="w-9 text-right text-xs text-faint-foreground tabular-nums">
            {formatRelativeShort(row.updated_at)}
          </span>
        </span>
      </Link>
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Empty + loading states                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** Nothing in the property yet: no list to search, so lead with the makers. */
function EmptyDirectory({
  propertyId,
  onGenerate,
}: {
  propertyId: string;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <p className="max-w-[52ch] text-base leading-6 text-pretty text-muted-foreground">
        A quiet shelf for everything your team is writing. Start one from
        scratch, draft it with AI, or bring a file you already have.
      </p>
      <QuickCreateRow propertyId={propertyId} onGenerate={onGenerate} />
    </div>
  );
}

function NoMatches({
  searching,
  fetching,
  onReset,
}: {
  searching: boolean;
  fetching: boolean;
  onReset: () => void;
}) {
  if (searching && fetching) return <ListSkeleton rows={3} />;
  return (
    <EmptyState
      icon={searching ? Search : FileText}
      title={
        searching ? "No documents match that search" : "Nothing in this view"
      }
      action={
        <Button variant="outline" size="sm" onClick={onReset}>
          {searching ? "Clear search" : "Clear filters"}
        </Button>
      }
    >
      {searching
        ? "Both titles and body text were searched."
        : "Try a different type or team."}
    </EmptyState>
  );
}

function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <Skeleton className="mb-2 ml-2 h-3 w-20" />
        <ul className="flex flex-col">
          {Array.from({ length: rows }).map((_, i) => (
            <li key={i} className="flex h-[37px] items-center gap-3 px-2">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <Skeleton className="h-3.5 w-56" />
              <Skeleton className="ml-auto h-3 w-14" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Sorting + grouping                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function sortRows(rows: DirectoryRow[], sort: DirectorySort): DirectoryRow[] {
  const out = [...rows];
  if (sort === "title") {
    out.sort((a, b) =>
      (a.title || "Untitled").localeCompare(b.title || "Untitled", undefined, {
        sensitivity: "base",
      }),
    );
    return out;
  }
  const key = sort === "created" ? "created_at" : "updated_at";
  out.sort(
    (a, b) =>
      new Date(b[key] ?? b.updated_at).getTime() -
      new Date(a[key] ?? a.updated_at).getTime(),
  );
  return out;
}

type TimeBucket = "today" | "thisWeek" | "thisMonth" | "older";

const BUCKET_LABELS: Record<TimeBucket, string> = {
  today: "Today",
  thisWeek: "This week",
  thisMonth: "Earlier this month",
  older: "Older",
};

function bucketFor(iso: string): TimeBucket {
  const now = new Date();
  const then = new Date(iso);
  const sameDay =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate();
  if (sameDay) return "today";
  const diffDays = (now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000);
  if (diffDays < 7) return "thisWeek";
  if (diffDays < 31) return "thisMonth";
  return "older";
}

/**
 * Time buckets are the recency sorts' group headers — they're what makes
 * "Recently edited" redundant as a separate section. A title sort has no time
 * story to tell, and search results are ranked by relevance, so both render as
 * one unlabelled run (`label: null`).
 */
function groupRows(
  rows: DirectoryRow[],
  sort: DirectorySort | null,
): { label: string | null; items: DirectoryRow[] }[] {
  if (!rows.length) return [];
  if (sort === null || sort === "title")
    return [{ label: null, items: rows }];

  const field = sort === "created" ? "created_at" : "updated_at";
  const buckets = new Map<TimeBucket, DirectoryRow[]>();
  for (const r of rows) {
    const b = bucketFor(r[field] ?? r.updated_at);
    const list = buckets.get(b) ?? [];
    list.push(r);
    buckets.set(b, list);
  }
  const order: TimeBucket[] = ["today", "thisWeek", "thisMonth", "older"];
  return order
    .map((b) => ({ label: BUCKET_LABELS[b], items: buckets.get(b) ?? [] }))
    .filter((g) => g.items.length > 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Shared helpers                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/** Value-then-faint-label, identical to the Home widgets' `Stats` one-liner
 *  (components/home/editorial-section.tsx) — one stat voice across the app. */
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="text-base font-semibold tabular-nums text-foreground">
        {value}
      </dd>
      <dt className="text-faint-foreground">{label}</dt>
    </div>
  );
}

function UnpinZone({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={cn(className, "transition-colors", isOver && "bg-accent")}
    >
      {children}
    </section>
  );
}

/** First line of body text, whitespace-collapsed, for the row's second column. */
function snippet(body: string | null | undefined): string {
  if (!body) return "";
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS)}…`
    : flat;
}

/**
 * Pre-tokenize a query for `<mark>` highlighting. We don't try to match
 * Postgres' `websearch_to_tsquery` semantics exactly — lowercase, length>=2,
 * regex-escaped catches the words a user expects to see emphasized.
 */
function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 2)
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    ),
  );
}

function highlight(text: string, tokens: string[]): React.ReactNode {
  if (tokens.length === 0) return text;
  // `String.split` with a capture group puts the captured matches at the ODD
  // indices. Testing each part against the pattern instead looks obvious but
  // is wrong: a `/g` regex carries `lastIndex` between `.test()` calls, so it
  // alternates true/false and highlights roughly half the real matches.
  return text
    .split(new RegExp(`(${tokens.join("|")})`, "gi"))
    .map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="bg-annotation-mark text-foreground">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

/** Compact relative time ("now", "3m", "2h", "5d", or absolute date past 7d). */
function formatRelativeShort(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
