"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { FileText, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/ui/eyebrow";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import {
  documentBoardsQueryOptions,
  documentsQueryOptions,
} from "@/lib/query/section-queries";
import type { DocumentListItem } from "@/lib/documents/queries";
import { QuickCreateRow } from "./quick-create-row";
import { GenerateDocumentDialog } from "./generate-document-dialog";
import { DocBoardsSection } from "./doc-boards-section";
import { DocBoardsBoard } from "./doc-boards-board";
import { DocsActivitySheet } from "./docs-activity-panel";
import { useDocsHomePresence } from "./docs-home-presence";
import { DocumentSearch } from "./document-search";
import { DocumentViewerAvatarStack } from "@/components/documents/document-presence-stack";
import { useMemberName } from "@/lib/documents/use-member-name";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";

/**
 * The row-list column. Boards are a horizontally scrolling gallery and take
 * the whole pane; a list of 34px document rows does not want to be 1700px
 * wide, so the lists keep the old 1152px reading measure. Prose (the
 * masthead) is narrower still — `max-w-content`, 720px.
 */
const LIST_COL = "mx-auto w-full max-w-6xl";

const RECENTLY_EDITED_LIMIT = 6;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Documents section home — Editorial layout.
 *
 * `DocBoardsBoard` provides the shared `DocsHomePresenceProvider` + `DndContext`
 * (so a row drag in any list variant can land on a board, or be dragged back
 * into the library section to unpin it) — the same shell the property Home
 * surface uses. The actual layout is in `<EditorialLayout>` so it has access to
 * the shared presence map.
 */
export function DocumentsHome({ propertyId }: { propertyId: string }) {
  const [generateOpen, setGenerateOpen] = useState(false);
  return (
    <DocBoardsBoard propertyId={propertyId}>
      <DocumentsHomeBody
        propertyId={propertyId}
        generateOpen={generateOpen}
        setGenerateOpen={setGenerateOpen}
      />
    </DocBoardsBoard>
  );
}

function DocumentsHomeBody({
  propertyId,
  generateOpen,
  setGenerateOpen,
}: {
  propertyId: string;
  generateOpen: boolean;
  setGenerateOpen: (open: boolean) => void;
}) {
  const { data: docs, isError: docsError } = useQuery(
    documentsQueryOptions(propertyId),
  );
  const { data: boards = [] } = useQuery(documentBoardsQueryOptions(propertyId));

  const docsList = docs ?? [];
  const recentlyEdited = useMemo(
    () => docsList.slice(0, RECENTLY_EDITED_LIMIT),
    [docsList],
  );
  const editsThisWeek = useMemo(() => {
    const cutoff = Date.now() - ONE_WEEK_MS;
    return docsList.filter((d) => new Date(d.updated_at).getTime() >= cutoff)
      .length;
  }, [docsList]);

  const hasDocs = docsList.length > 0;
  const hasRecentlyEdited = recentlyEdited.length > 0;

  return (
    <>
      <EditorialLayout
        propertyId={propertyId}
        docsError={docsError}
        recentlyEdited={recentlyEdited}
        hasRecentlyEdited={hasRecentlyEdited}
        hasDocs={hasDocs}
        docsCount={docsList.length}
        boardsCount={boards.length}
        editsThisWeek={editsThisWeek}
        onGenerate={() => setGenerateOpen(true)}
      />

      <GenerateDocumentDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        propertyId={propertyId}
      />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Editorial layout                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function EditorialLayout({
  propertyId,
  docsError,
  recentlyEdited,
  hasRecentlyEdited,
  hasDocs,
  docsCount,
  boardsCount,
  editsThisWeek,
  onGenerate,
}: {
  propertyId: string;
  docsError: boolean;
  recentlyEdited: DocumentListItem[];
  hasRecentlyEdited: boolean;
  hasDocs: boolean;
  docsCount: number;
  boardsCount: number;
  editsThisWeek: number;
  onGenerate: () => void;
}) {
  return (
    // The SCROLLER is uncapped on purpose. It used to be `max-w-6xl`, which
    // silently defeated the 720/full-bleed contrast the masthead below sets
    // up: with a 1152px cap, the "full-width" board strips were centred in a
    // 1152 box on any wide display and the page read as one indented column.
    // Prose (masthead) → `max-w-content`; row lists → `LIST_COL`; the board
    // strips take the whole pane (notion-spec-v2 §3).
    <div className="flex h-full w-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      {/* Masthead and content separate by WHITESPACE — the full-width rule
          that used to sit between them is gone (notion-spec §1). */}
      {/* The masthead is PROSE, so it sits in the 720px document column while
          the boards/library below break out to full width (notion-spec-v2
          §3). That contrast is the layout. */}
      <header className="mx-auto mb-14 flex w-full max-w-content flex-col gap-10">
        <div className="flex items-center justify-end gap-6">
          <DocsActivitySheet propertyId={propertyId} />
        </div>
        <div className="flex flex-col gap-5">
          <h1 className="text-[2.5rem] leading-[3rem] font-bold text-balance text-foreground">
            Directory
          </h1>
          <p className="max-w-[52ch] text-base leading-6 text-pretty text-muted-foreground">
            A quiet shelf for everything your team is writing. Pin the
            essentials, follow the recent edits, or browse the full library
            below.
          </p>
          {/* Whitespace-separated stat one-liner — the same shape the Home
              widgets use. The vertical hairlines that used to sit between the
              columns are gone (DESIGN.md: stats never get rules). */}
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 pt-3 text-sm text-muted-foreground">
            <Stat label="In the library" value={docsCount} />
            <Stat label="On boards" value={boardsCount} />
            <Stat label="Edits this week" value={editsThisWeek} />
          </dl>
        </div>
        <div className="flex flex-col gap-4">
          <Eyebrow>Create</Eyebrow>
          <QuickCreateRow propertyId={propertyId} onGenerate={onGenerate} />
        </div>
      </header>

      <div className={cn(LIST_COL, "mb-12 max-w-xl")}>
        <DocumentSearch propertyId={propertyId} />
      </div>

      {docsError ? (
        <p className={cn(LIST_COL, "mb-10 text-sm text-destructive")}>
          Could not load documents. Try refreshing the page.
        </p>
      ) : null}

      <div className="flex flex-col gap-16">
        {/* The board strips are the DATA VIEW — they scroll horizontally and
            take the full pane, no column cap. */}
        <section>
          <EditorialHeading kicker="On the boards">
            Pinned by the team
          </EditorialHeading>
          <DocBoardsSection propertyId={propertyId} />
        </section>

        {hasRecentlyEdited ? (
          <section className={LIST_COL}>
            <EditorialHeading kicker="In motion">
              Recently edited
            </EditorialHeading>
            <GroupedList
              propertyId={propertyId}
              docs={recentlyEdited}
              draggable
            />
          </section>
        ) : null}

        <UnpinZone id="unpin-zone:editorial" className={cn(LIST_COL, "rounded-md")}>
          <section>
            <EditorialHeading
              kicker="The library"
              right={
                hasDocs ? (
                  <span className="text-xs text-faint-foreground tabular-nums">
                    {docsCount}{" "}
                    {docsCount === 1 ? "document" : "documents"}
                  </span>
                ) : null
              }
            >
              All documents
            </EditorialHeading>
            <p className="mb-6 max-w-[60ch] text-sm text-pretty text-muted-foreground">
              Grouped by when each document was last touched. Drag a row
              onto a board above to pin it for your team — drop it back here
              to take it off the board.
            </p>
            <EditorialAllDocsList propertyId={propertyId} />
          </section>
        </UnpinZone>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  All documents wrapper — owns the query, then defers to the grouped list   */
/* ────────────────────────────────────────────────────────────────────────── */

function EditorialAllDocsList({ propertyId }: { propertyId: string }) {
  const { data, isPending, isError, error } = useQuery(
    documentsQueryOptions(propertyId),
  );
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  // Team lens: "all" | "general" (no team) | a space id. Docs are tagged with
  // a team via the team workspace's Docs panel — this makes that organization
  // visible from the library instead of one long pile.
  const [teamLens, setTeamLens] = useState<string>("all");

  if (isPending) {
    return (
      <div className="flex flex-col gap-10">
        {Array.from({ length: 2 }).map((_, gi) => (
          <section key={gi}>
            <Skeleton className="mb-3 h-3 w-24" />
            <ul className="flex flex-col gap-px">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex h-[37px] items-center gap-3 px-2">
                  <Skeleton className="size-4 shrink-0 rounded-sm" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="ml-auto h-3 w-16" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Could not load documents
        {error instanceof Error ? `: ${error.message}` : "."}
      </div>
    );
  }

  const docs = data ?? [];
  if (docs.length === 0) {
    return (
      <EmptyState icon={FileText} title="No documents yet" />
    );
  }

  const shown =
    teamLens === "all"
      ? docs
      : teamLens === "general"
        ? docs.filter((d) => !d.space_id)
        : docs.filter((d) => d.space_id === teamLens);
  const generalCount = docs.filter((d) => !d.space_id).length;

  return (
    <div className="flex flex-col gap-6">
      {spaces.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            size="sm"
            selected={teamLens === "all"}
            onClick={() => setTeamLens("all")}
          >
            All
          </Chip>
          {spaces.map((s) => {
            const count = docs.filter((d) => d.space_id === s.id).length;
            if (count === 0) return null;
            return (
              <Chip
                key={s.id}
                size="sm"
                selected={teamLens === s.id}
                onClick={() => setTeamLens(teamLens === s.id ? "all" : s.id)}
              >
                {s.icon ? <span>{s.icon}</span> : null}
                {s.name}
                <span className="text-muted-foreground tabular-nums">
                  {count}
                </span>
              </Chip>
            );
          })}
          {generalCount > 0 ? (
            <Chip
              size="sm"
              selected={teamLens === "general"}
              onClick={() =>
                setTeamLens(teamLens === "general" ? "all" : "general")
              }
            >
              General
              <span className="text-muted-foreground tabular-nums">
                {generalCount}
              </span>
            </Chip>
          ) : null}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState title="No documents in this team yet" />
      ) : (
        <GroupedList propertyId={propertyId} docs={shown} draggable />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Documents list — grouped by time                                          */
/* ────────────────────────────────────────────────────────────────────────── */

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

function GroupedList({
  propertyId,
  docs,
  draggable,
}: {
  propertyId: string;
  docs: DocumentListItem[];
  draggable: boolean;
}) {
  const groups = useMemo(() => {
    const buckets = new Map<TimeBucket, DocumentListItem[]>();
    for (const d of docs) {
      const b = bucketFor(d.updated_at);
      const list = buckets.get(b) ?? [];
      list.push(d);
      buckets.set(b, list);
    }
    const order: TimeBucket[] = ["today", "thisWeek", "thisMonth", "older"];
    return order
      .map((b) => ({ bucket: b, items: buckets.get(b) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [docs]);

  return (
    <div className="flex flex-col gap-10">
      {groups.map((g) => (
        <section key={g.bucket}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <Eyebrow>{BUCKET_LABELS[g.bucket]}</Eyebrow>
            <span className="text-xs text-faint-foreground tabular-nums">
              {g.items.length}
            </span>
          </div>
          <ul role="list" className="flex flex-col gap-px">
            {g.items.map((d) => (
              <TimelineRow
                key={d.id}
                propertyId={propertyId}
                doc={d}
                draggable={draggable}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TimelineRow({
  propertyId,
  doc,
  draggable,
}: {
  propertyId: string;
  doc: DocumentListItem;
  draggable: boolean;
}) {
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);
  const viewers = useDocsHomePresence(doc.id);
  const editorName = useMemberName(propertyId, doc.last_edited_by);

  // Per-instance id: the same doc can appear in more than one list, and dnd-kit
  // keys drag state by id — a shared `doc:<id>` would drag every copy at once.
  // The real document is resolved from `data.documentId` in the DnD handlers.
  const instanceId = useId();
  const drag = useDraggable({
    id: `doc:${instanceId}`,
    data: { type: "doc", documentId: doc.id },
    disabled: !draggable,
  });

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(doc.id);
  }

  const rowProps = draggable
    ? {
        ref: drag.setNodeRef,
        style: { transform: CSS.Translate.toString(drag.transform) },
      }
    : {};

  return (
    <li
      {...rowProps}
      className={cn(
        "group/row relative",
        draggable && drag.isDragging && "opacity-40",
      )}
    >
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(doc.id)}
        draggable={false}
        className="flex min-h-[37px] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
      >
        {draggable ? (
          // Drag handle: only the grip starts a drag, so grabbing the row's
          // title or timestamp navigates instead of dragging. Clicks on the
          // grip are swallowed so it never follows the link.
          <span
            {...drag.attributes}
            {...drag.listeners}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            aria-label="Drag to pin to a board"
            className="-mx-1 flex shrink-0 cursor-grab items-center self-stretch px-1 text-faint-foreground active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="size-4" />
          </span>
        ) : (
          <FileText
            strokeWidth={1.5}
            className="size-4 shrink-0 text-faint-foreground"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {doc.title || "Untitled"}
        </span>
        {editorName ? (
          <span className="hidden truncate text-xs text-faint-foreground sm:inline">
            {editorName}
          </span>
        ) : null}
        <span className="flex shrink-0 items-center gap-2">
          <DocumentViewerAvatarStack users={viewers} size={18} />
          <span className="text-xs text-faint-foreground tabular-nums">
            {formatRelativeShort(doc.updated_at)}
          </span>
        </span>
      </Link>
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Shared helpers                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function EditorialHeading({
  kicker,
  children,
  right,
}: {
  kicker: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-2">
        <Eyebrow>{kicker}</Eyebrow>
        <h2 className="text-base leading-6 font-semibold text-foreground">
          {children}
        </h2>
      </div>
      {right}
    </div>
  );
}

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
      className={cn(
        className,
        "transition-colors",
        isOver && "bg-accent",
      )}
    >
      {children}
    </section>
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

