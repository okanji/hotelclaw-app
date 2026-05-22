"use client";

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
import { FileText, Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocumentRow } from "./document-row";
import { Button } from "@/components/ui/button";
import {
  documentBoardsQueryOptions,
  documentsQueryOptions,
} from "@/lib/query/section-queries";
import { createDocument } from "./actions";
import { DocBoardsSection, useBoardMutations } from "./doc-boards-section";
import { DocsActivitySheet } from "./docs-activity-panel";
import { DocsHomePresenceProvider } from "./docs-home-presence";
import { DocumentList } from "./document-list";
import { DocumentSearch } from "./document-search";

const RECENTLY_EDITED_LIMIT = 6;

/**
 * Documents section home / dashboard.
 *
 * Three stacked sections, top → bottom:
 *
 *   • Boards — team-shared, drag-and-drop dashboard of pinned doc cards
 *     organized into named/colored boards (see `<DocBoardsSection>`).
 *   • Recently edited — the last few docs updated on this property (from
 *     `documents.updated_at`, synced when anyone edits title or body).
 *   • All documents — `<DocumentList>` (drag-source for the boards above;
 *     rows are `useDraggable`).
 *
 * The whole page is wrapped in a single `DndContext` so a drag started on a
 * list row can land on a board (or a board card can be dragged back onto the
 * `unpin-zone` All-documents wrapper to remove it from boards).
 */
export function DocumentsHome({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [creating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: docs, isError: docsError } = useQuery(documentsQueryOptions(propertyId));
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

  const recentlyEdited = useMemo(
    () => docsList.slice(0, RECENTLY_EDITED_LIMIT),
    [docsList],
  );

  const hasDocs = docsList.length > 0;
  const hasRecentlyEdited = recentlyEdited.length > 0;

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
    <DocsHomePresenceProvider propertyId={propertyId}>
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-8 sm:py-10 lg:max-w-7xl">
        {/* Title row and description sit on separate lines so the actions
            hug the heading at the right edge instead of being pushed off
            into the dead space `justify-between` would create. Mobile
            stacks: title → actions → description. */}
        <header className="mb-10 flex flex-col gap-3 sm:gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              Documents
            </h1>
            <DocsActivitySheet propertyId={propertyId} />
          </div>
          <p className="max-w-[64ch] text-sm text-pretty text-muted-foreground">
            Pin favorites to boards, see what changed recently, or browse the
            full library.
          </p>
        </header>

        {docsError ? (
          <p className="mb-6 text-sm text-destructive">
            Could not load documents. Try refreshing the page.
          </p>
        ) : null}

        {/* Search collapses into a single empty input row when no query is
            active, so it doesn't crowd the boards strip below. The result
            list only renders once the debounced query crosses 2 chars. */}
        <div className="mb-8">
          <DocumentSearch propertyId={propertyId} />
        </div>

        <div className="flex flex-col gap-10 lg:gap-12">
          <DocBoardsSection propertyId={propertyId} />

          <div className="flex flex-col gap-8">
            {hasRecentlyEdited ? (
              <section>
                <SectionHeading
                  icon={<Pencil strokeWidth={1.75} className="size-3.5" />}
                  right={
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {recentlyEdited.length}
                    </span>
                  }
                >
                  Recently edited
                </SectionHeading>
                <ul role="list" className="flex flex-col gap-0.5">
                  {recentlyEdited.map((d) => (
                    <DocumentRow
                      key={d.id}
                      propertyId={propertyId}
                      doc={d}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            <AllDocumentsSection
              hasDocs={hasDocs}
              count={docsList.length}
              createError={createError}
              creating={creating}
              onCreate={handleCreate}
            >
              <DocumentList propertyId={propertyId} />
            </AllDocumentsSection>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeGhost ? <DragGhost title={activeGhost.title} /> : null}
      </DragOverlay>
    </DndContext>
    </DocsHomePresenceProvider>
  );
}

/** The All-documents wrapper doubles as the unpin drop zone. */
function AllDocumentsSection({
  hasDocs,
  count,
  createError,
  creating,
  onCreate,
  children,
}: {
  hasDocs: boolean;
  count: number;
  createError: string | null;
  creating: boolean;
  onCreate: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "unpin-zone" });
  return (
    <section ref={setNodeRef}>
      <SectionHeading
        right={
          <div className="flex shrink-0 items-center gap-2">
            {hasDocs ? (
              <span className="text-sm text-muted-foreground tabular-nums">
                {count} {count === 1 ? "doc" : "docs"}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={onCreate}
              disabled={creating}
            >
              <Plus className="size-4" />
              {creating ? "Creating…" : "New document"}
            </Button>
          </div>
        }
      >
        All documents
      </SectionHeading>
      {createError ? (
        <p className="mb-3 text-sm text-destructive">{createError}</p>
      ) : (
        <p className="mb-3 text-sm text-pretty text-muted-foreground">
          Drag a document onto a board to pin it for your team.
        </p>
      )}
      <div
        className={cn(
          "rounded-lg transition-shadow",
          isOver && "ring-2 ring-foreground/15",
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
  icon,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        {icon ? (
          <span className="text-muted-foreground" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Compact card preview that follows the cursor during a pin/unpin drag. */
function DragGhost({ title }: { title: string }) {
  return (
    <div className="flex h-12 w-56 items-center gap-2.5 rounded-lg border border-border bg-card px-3 shadow-lg ring-1 ring-foreground/10 dark:shadow-none dark:inset-ring dark:inset-ring-white/5">
      <FileText
        strokeWidth={1.5}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="truncate text-sm font-medium">{title}</span>
    </div>
  );
}
