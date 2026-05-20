"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FileText, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  documentBoardsQueryOptions,
  documentsQueryOptions,
} from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { createDocument } from "./actions";
import { DocBoardsSection, useBoardMutations } from "./doc-boards-section";
import { DocumentList } from "./document-list";
import { useRecentDocs } from "@/lib/documents/use-recent-docs";

/**
 * Documents section home / dashboard.
 *
 * Three stacked sections, top → bottom:
 *
 *   • Boards — team-shared, drag-and-drop dashboard of pinned doc cards
 *     organized into named/colored boards (see `<DocBoardsSection>`).
 *   • Recently opened — the last few docs the user opened, recorded by
 *     `<RecentDocsRecorder>` mounted on the doc detail route.
 *   • All documents — `<DocumentList>` (drag-source for the boards above;
 *     rows are `useDraggable`).
 *
 * The whole page is wrapped in a single `DndContext` so a drag started on a
 * list row can land on a board (or a board card can be dragged back onto the
 * `unpin-zone` All-documents wrapper to remove it from boards).
 */
export function DocumentsHome({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const openDocument = useOpenDocument(propertyId);
  const [creating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  // Plain left-click → client-side `pushState` switch via the persistent
  // DocumentsSurface (no route nav, no skeleton flash). Modified clicks fall
  // through to the browser so "open in new tab" still works.
  function handleOpen(
    e: React.MouseEvent<HTMLAnchorElement>,
    documentId: string,
  ) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(documentId);
  }

  const { data: docs } = useQuery(documentsQueryOptions(propertyId));
  const { data: boards = [] } = useQuery(documentBoardsQueryOptions(propertyId));
  const { pin, unpin } = useBoardMutations(propertyId);

  const docsList = docs ?? [];
  const docsById = useMemo(
    () => new Map(docsList.map((d) => [d.id, d])),
    [docsList],
  );
  // Quick lookup: which board does this doc live in? Used when a drop lands
  // on a *card* (not the board strip itself) — we resolve "card-over-card"
  // to "move to that card's board, append at the end".
  const boardByDocId = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of boards) {
      for (const i of b.items) m.set(i.document_id, b.id);
    }
    return m;
  }, [boards]);

  const recents = useRecentDocs(propertyId);
  const recentDocs = useMemo(
    () =>
      recents
        .map((e) => {
          const doc = docsById.get(e.id);
          return doc ? { ...doc, openedAt: e.openedAt } : null;
        })
        .filter((d): d is NonNullable<typeof d> => !!d)
        .slice(0, 6),
    [recents, docsById],
  );

  const hasDocs = docsList.length > 0;
  const hasRecents = recentDocs.length > 0;

  function handleCreate() {
    setCreateError(null);
    startCreate(async () => {
      const res = await createDocument(propertyId);
      if ("error" in res) {
        setCreateError(res.error);
        return;
      }
      router.push(`/p/${propertyId}/documents/${res.id}`);
    });
  }

  // ── DnD ───────────────────────────────────────────────────────────────────
  // 6px activation distance: a plain click on a row navigates; a 6px drag
  // starts the pin/unpin gesture. Pointer sensor only — touch users still get
  // the regular tap-to-open via the underlying Link.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [activeGhost, setActiveGhost] = useState<{
    documentId: string;
    title: string;
  } | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const documentId = id.split(":")[1];
    if (!documentId) return;
    const doc = docsById.get(documentId);
    if (doc) setActiveGhost({ documentId: doc.id, title: doc.title });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveGhost(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const isCardSource = activeId.startsWith("card:");
    const documentId = activeId.split(":")[1];
    if (!documentId) return;

    // Unpin: dragging a board card onto the all-documents section.
    if (overId === "unpin-zone") {
      if (isCardSource) void unpin(documentId);
      return;
    }

    // Pin / move: figure out the target board id.
    let targetBoardId: string | undefined;
    if (overId.startsWith("board:")) {
      targetBoardId = overId.slice("board:".length);
    } else if (overId.startsWith("card:")) {
      const targetDocId = overId.slice("card:".length);
      if (targetDocId === documentId) return;
      targetBoardId = boardByDocId.get(targetDocId);
    }
    if (!targetBoardId) return;

    void pin(documentId, targetBoardId);
  }

  function handleDragCancel() {
    setActiveGhost(null);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-6 py-10">
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
            <p className="text-sm text-muted-foreground">
              Boards, recently opened, and everything else for this property.
            </p>
          </div>
          <Button type="button" onClick={handleCreate} disabled={creating}>
            <Plus className="size-4" /> New document
          </Button>
        </header>

        {createError ? (
          <p className="mb-4 text-sm text-destructive">{createError}</p>
        ) : null}

        <DocBoardsSection propertyId={propertyId} />

        {hasRecents ? (
          <section className="mb-8">
            <SectionHeading>Recently opened</SectionHeading>
            <ul className="space-y-0.5">
              {recentDocs.map((d) => (
                <li key={d.id}>
                  <Link
                    href={documentHref(propertyId, d.id)}
                    onClick={(e) => handleOpen(e, d.id)}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{d.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {relativeTime(d.openedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <AllDocumentsSection hasDocs={hasDocs} count={docsList.length}>
          <DocumentList propertyId={propertyId} />
        </AllDocumentsSection>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeGhost ? <DragGhost title={activeGhost.title} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/** The All-documents wrapper doubles as the unpin drop zone. */
function AllDocumentsSection({
  hasDocs,
  count,
  children,
}: {
  hasDocs: boolean;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "unpin-zone" });
  return (
    <section ref={setNodeRef}>
      <SectionHeading
        right={
          hasDocs ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {count} {count === 1 ? "doc" : "docs"}
            </span>
          ) : null
        }
      >
        All documents
      </SectionHeading>
      <div
        className={cn(
          "rounded-lg transition-shadow",
          isOver && "ring-2 ring-foreground/20",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function SectionHeading({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Compact card preview that follows the cursor during a pin/unpin drag. */
function DragGhost({ title }: { title: string }) {
  return (
    <div className="flex h-12 w-56 items-center gap-2 rounded-lg border border-border bg-card px-3 shadow-lg ring-1 ring-foreground/10">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm font-medium">{title}</span>
    </div>
  );
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
