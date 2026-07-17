"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { FileText, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "@/components/ui/eyebrow";
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
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <header className="flex flex-col gap-10">
        <div className="flex items-center justify-end gap-6">
          <DocsActivitySheet propertyId={propertyId} />
        </div>
        <div className="flex flex-col gap-5">
          <h1 className="font-serif text-5xl font-medium tracking-tight text-foreground sm:text-6xl">
            Directory
          </h1>
          <p className="max-w-[52ch] text-base leading-relaxed tracking-tight text-pretty text-muted-foreground">
            A quiet shelf for everything your team is writing. Pin the
            essentials, follow the recent edits, or browse the full library
            below.
          </p>
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 pt-3 text-sm tracking-tight text-muted-foreground">
            <Stat label="In the library" value={docsCount} />
            <Separator orientation="vertical" className="h-3.5" />
            <Stat label="On boards" value={boardsCount} />
            <Separator orientation="vertical" className="h-3.5" />
            <Stat label="Edits this week" value={editsThisWeek} />
          </dl>
        </div>
        <div className="flex flex-col gap-4">
          <Eyebrow>Create</Eyebrow>
          <QuickCreateRow propertyId={propertyId} onGenerate={onGenerate} />
        </div>
      </header>

      <hr className="my-12 border-border" />

      <div className="mb-12 max-w-xl">
        <DocumentSearch propertyId={propertyId} />
      </div>

      {docsError ? (
        <p className="mb-10 text-sm text-destructive">
          Could not load documents. Try refreshing the page.
        </p>
      ) : null}

      <div className="flex flex-col gap-16">
        <section>
          <EditorialHeading kicker="On the boards">
            Pinned by the team
          </EditorialHeading>
          <DocBoardsSection propertyId={propertyId} />
        </section>

        {hasRecentlyEdited ? (
          <section>
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

        <UnpinZone id="unpin-zone:editorial" className="rounded-lg">
          <section>
            <EditorialHeading
              kicker="The library"
              right={
                hasDocs ? (
                  <span className="text-xs tracking-tight text-muted-foreground tabular-nums">
                    {docsCount}{" "}
                    {docsCount === 1 ? "document" : "documents"}
                  </span>
                ) : null
              }
            >
              All documents
            </EditorialHeading>
            <p className="mb-6 max-w-[60ch] text-sm leading-relaxed tracking-tight text-pretty text-muted-foreground">
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

  if (isPending) {
    return (
      <div className="flex flex-col gap-10">
        {Array.from({ length: 2 }).map((_, gi) => (
          <section key={gi}>
            <Skeleton className="mb-3 h-3 w-24" />
            <ul className="flex flex-col divide-y divide-border/40 border-t border-border/40">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex items-center gap-3 px-2 py-3">
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
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Could not load documents
        {error instanceof Error ? `: ${error.message}` : "."}
      </div>
    );
  }

  const docs = data ?? [];
  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 px-6 py-12 text-center">
        <FileText
          strokeWidth={1.5}
          className="size-7 text-muted-foreground/50"
        />
        <p className="text-sm text-pretty text-muted-foreground">
          No documents yet.
        </p>
      </div>
    );
  }

  return <GroupedList propertyId={propertyId} docs={docs} draggable />;
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
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {BUCKET_LABELS[g.bucket]}
            </h3>
            <span className="text-xs tracking-tight text-muted-foreground/70 tabular-nums">
              {g.items.length}
            </span>
          </div>
          <ul
            role="list"
            className="flex flex-col divide-y divide-border/40 border-t border-border/40"
          >
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
        className="flex items-center gap-3 px-2 py-2.5"
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
            className="-mx-1 flex shrink-0 cursor-grab items-center self-stretch px-1 text-muted-foreground/30 hover:text-muted-foreground/60 active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="size-4" />
          </span>
        ) : (
          <FileText
            strokeWidth={1.5}
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-foreground">
          {doc.title || "Untitled"}
        </span>
        {editorName ? (
          <span className="hidden truncate text-xs tracking-tight text-muted-foreground sm:inline">
            {editorName}
          </span>
        ) : null}
        <span className="flex shrink-0 items-center gap-2">
          <DocumentViewerAvatarStack users={viewers} size={18} />
          <span className="text-xs tracking-tight text-muted-foreground tabular-nums">
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
    <div className="mb-6 flex items-end justify-between gap-3 border-b border-border pb-3">
      <div className="flex flex-col gap-1">
        <Eyebrow tone="brand">{kicker}</Eyebrow>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {children}
        </h2>
      </div>
      {right}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground/80">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
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
        "transition-shadow",
        isOver && "ring-2 ring-foreground/15",
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

