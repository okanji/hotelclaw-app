"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import {
  FileText,
  FolderOpen,
  GripVertical,
  SearchX,
  Table2,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Empty } from "@/components/gr8r/members-shared";
import { PageHeader } from "@/components/shell/page-header";
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
import { AutomationsButton } from "@/components/workflows/automations-button";
import { useDocsHomePresence } from "./docs-home-presence";
import {
  DEFAULT_DIRECTORY_VIEW,
  DirectoryToolbar,
  type DirectoryLayout,
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
const LAYOUT_KEY = "hotelclaw:docs-layout";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

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
  const [layout, setLayout] = useDirectoryLayout();
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
  // Stable per mount — reading the clock during render is impure.
  const [weekAgo] = useState(() => Date.now() - ONE_WEEK_MS);
  const editsThisWeek = useMemo(
    () =>
      docsList.filter((d) => new Date(d.updated_at).getTime() >= weekAgo)
        .length,
    [docsList, weekAgo],
  );

  const queryTokens = useMemo(
    () => (searching ? tokenize(trimmed) : []),
    [searching, trimmed],
  );

  const isEmptyProperty = !isPending && docsList.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title="Docs"
        icon={<FileText />}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <AutomationsButton propertyId={propertyId} feature="docs" />
            <DocsActivitySheet propertyId={propertyId} />
          </div>
        }
      />
      {/* gr8r's Files view (src/views/files.js) as the Directory: `.page.wide`
          → `.ph` → a sticky control row → boards shelf → the list (`.panel` of
          `.mini` rows) or the grid (`.fgrid` of `.fcard`s). No top padding on
          the scroller — a sticky child's offset is measured from the scroll
          container's CONTENT box. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          <div className="ph">
            <div>
              <h1>Docs</h1>
              <p>
                {isPending
                  ? "Everything your team is writing."
                  : `${docsList.length} in the library · ${boards.length} on boards · ${editsThisWeek} edited this week`}
              </p>
            </div>
          </div>
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
                layout={layout}
                onLayout={setLayout}
              />

              {docsError ? (
                <div className="alert danger" style={{ marginBottom: 16 }}>
                  Could not load documents. Try refreshing the page.
                </div>
              ) : null}

              {/* Boards are a curated shelf, not a search surface — while the
                  user is looking for something specific they're just noise. */}
              {searching ? null : (
                <div style={{ marginBottom: 28 }}>
                  <DocBoardsSection propertyId={propertyId} />
                </div>
              )}

              <UnpinZone id="unpin-zone:directory">
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
                  <div className="col" style={{ gap: 20 }}>
                    {groups.map((g) => (
                      <section key={g.label ?? "_all"}>
                        {g.label ? (
                          <div
                            className="row"
                            style={{ marginBottom: 8, padding: "0 2px" }}
                          >
                            <h2 className="sec">{g.label}</h2>
                            <span className="faint num" style={{ fontSize: 12 }}>
                              {g.items.length}
                            </span>
                          </div>
                        ) : null}
                        {layout === "grid" ? (
                          <ul role="list" className="fgrid">
                            {g.items.map((r) => (
                              <DocumentRow
                                key={r.id}
                                propertyId={propertyId}
                                row={r}
                                tokens={queryTokens}
                                layout="grid"
                              />
                            ))}
                          </ul>
                        ) : (
                          <ul role="list" className="panel">
                            {g.items.map((r) => (
                              <DocumentRow
                                key={r.id}
                                propertyId={propertyId}
                                row={r}
                                tokens={queryTokens}
                                layout="list"
                              />
                            ))}
                          </ul>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </UnpinZone>
            </>
          )}
        </div>
      </div>
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
  layout,
}: {
  propertyId: string;
  row: DirectoryRow;
  tokens: string[];
  layout: DirectoryLayout;
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

  const sheet = row.kind === "sheet";
  const Icon = sheet ? Table2 : FileText;
  const tint = { "--g8-c": sheet ? "var(--g8-green)" : "var(--g8-accent)" } as CSSVars;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(row.id);
  }

  const grip = (
    <span
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      aria-label="Drag to pin to a board"
      title="Drag to pin to a board"
      className="ibtn ibtn-xs g8-doc-grip"
    >
      <Gi icon={GripVertical} size={13} />
    </span>
  );

  const liStyle = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
    listStyle: "none",
  };

  if (layout === "grid") {
    return (
      <li ref={setNodeRef} style={liStyle} className="fcard g8-doc-card">
        <Link
          href={documentHref(propertyId, row.id)}
          onClick={handleClick}
          onMouseEnter={() => prewarm(row.id)}
          draggable={false}
          style={{ color: "inherit", textDecoration: "none", display: "block" }}
        >
          {/* gr8r's `filePrev`: a paper "art" sheet with grey text bars, and
              the body's real first words where we have them. */}
          <div className="fprev" style={tint}>
            <div className="art">
              <i className="h" />
              {row.preview ? (
                <span className="g8-doc-snip">
                  {highlight(row.preview, tokens)}
                </span>
              ) : (
                <>
                  <i />
                  <i style={{ width: "85%" }} />
                  <i style={{ width: "70%" }} />
                </>
              )}
            </div>
            <span className="ext">{sheet ? "sheet" : "doc"}</span>
          </div>
          <div className="fi">
            <span className="fn trunc">{row.title || "Untitled"}</span>
            <span className="row" style={{ gap: 6 }}>
              <span className="fm trunc grow">
                {[editorName?.split(" ")[0], formatRelativeShort(row.updated_at)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <DocumentViewerAvatarStack users={viewers} size={16} />
            </span>
          </div>
        </Link>
        <span className="more" style={{ boxShadow: "none", background: "transparent" }}>
          {grip}
        </span>
      </li>
    );
  }

  return (
    <li ref={setNodeRef} style={liStyle} className="g8-doc-li">
      <Link
        href={documentHref(propertyId, row.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(row.id)}
        draggable={false}
        className="mini g8-doc-row"
        style={{ minHeight: 44, gap: 12, color: "inherit", textDecoration: "none" }}
      >
        {/* The type icon IS the row's left edge; the drag grip takes its
            place on hover so dragging to a board still works. */}
        <span className="g8-doc-ico">
          <span className="ftype" style={{ ...tint, width: 24, height: 24 }}>
            <Gi icon={Icon} size={13} />
          </span>
          {grip}
        </span>

        <span className="trunc" style={{ fontWeight: 500, flex: "0 1 auto", maxWidth: "36%" }}>
          {row.title || "Untitled"}
        </span>

        {/* `body_text` is already on every row — without the snippet a
            library of "Untitled document" rows has nothing to tell them
            apart. */}
        <span className="grow trunc faint hide-m" style={{ fontSize: 12.5 }}>
          {row.preview ? highlight(row.preview, tokens) : null}
        </span>

        <span className="row" style={{ marginLeft: "auto", gap: 12, flexShrink: 0 }}>
          <DocumentViewerAvatarStack users={viewers} size={18} />
          {editorName ? (
            <span className="muted trunc hide-m" style={{ fontSize: 12, maxWidth: 140 }}>
              {editorName}
            </span>
          ) : null}
          <span className="num faint" style={{ fontSize: 12, width: 44, textAlign: "right" }}>
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
    <div className="col" style={{ gap: 20 }}>
      <G8Empty
        icon={FolderOpen}
        title="No documents yet"
        text="A quiet shelf for everything your team is writing. Start one from scratch, draft it with AI, or bring a file you already have."
      />
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
    <G8Empty
      icon={searching ? SearchX : FolderOpen}
      title={searching ? "No results found" : "Nothing in this view"}
      text={
        searching
          ? "Both titles and body text were searched."
          : "Try a different type or team."
      }
    >
      <button type="button" className="btn btn-secondary btn-sm" onClick={onReset}>
        {searching ? "Clear search" : "Clear filters"}
      </button>
    </G8Empty>
  );
}

function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="panel">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mini" style={{ minHeight: 44, cursor: "default" }}>
          <span className="sk" style={{ width: 24, height: 24, borderRadius: 6 }} />
          <span className="sk" style={{ width: 220, height: 12 }} />
          <span className="sk" style={{ width: 48, height: 10, marginLeft: "auto" }} />
        </div>
      ))}
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

function UnpinZone({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={isOver ? "g8-doc-drop over" : "g8-doc-drop"}
    >
      {children}
    </section>
  );
}

/** Grid / list choice, remembered per device (gr8r's `fileView`). */
function useDirectoryLayout(): [DirectoryLayout, (l: DirectoryLayout) => void] {
  const [layout, setLayoutState] = useState<DirectoryLayout>("list");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(LAYOUT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate a per-device pref after mount
      if (v === "grid" || v === "list") setLayoutState(v);
    } catch {
      /* storage blocked */
    }
  }, []);
  const set = (l: DirectoryLayout) => {
    setLayoutState(l);
    try {
      window.localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* storage blocked */
    }
  };
  return [layout, set];
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
        <mark key={i} className="g8-doc-mark">
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
