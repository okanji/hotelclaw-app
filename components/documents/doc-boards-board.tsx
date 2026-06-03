"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FileText } from "lucide-react";
import {
  documentBoardsQueryOptions,
  documentsQueryOptions,
} from "@/lib/query/section-queries";
import { DocsHomePresenceProvider } from "./docs-home-presence";
import { useBoardMutations } from "./doc-boards-section";

/**
 * Shared drag-and-drop shell for the team boards strip.
 *
 * Owns the `DndContext` + drag overlay + presence provider that the boards
 * (`DocBoardsSection`) and any draggable doc rows rendered as `children` wire
 * into. Extracted from `documents-home.tsx` so the Docs "Directory" home and
 * the property Home surface share one implementation — a card dragged onto a
 * board, or a library row dropped back onto the unpin zone, behaves identically
 * on both surfaces.
 *
 * Drag sources:
 *  - `card:<docId>`  — a pinned card on a board (move between boards / unpin)
 *  - `doc:<docId>`   — a library/timeline row (pin onto a board)
 * Drop targets (declared by the children):
 *  - `board:<boardId>` / `card:<docId>` — pin onto / next to
 *  - `unpin-zone` / `unpin-zone:*`       — remove from its board
 */
export function DocBoardsBoard({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  return (
    <DocsHomePresenceProvider propertyId={propertyId}>
      <BoardsDnd propertyId={propertyId}>{children}</BoardsDnd>
    </DocsHomePresenceProvider>
  );
}

function BoardsDnd({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  const { data: docs } = useQuery(documentsQueryOptions(propertyId));
  const { data: boards = [] } = useQuery(documentBoardsQueryOptions(propertyId));
  const { pin, unpin } = useBoardMutations(propertyId);

  const docsById = useMemo(
    () => new Map((docs ?? []).map((d) => [d.id, d])),
    [docs],
  );
  const boardByDocId = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of boards) {
      for (const i of b.items) m.set(i.document_id, b.id);
    }
    return m;
  }, [boards]);

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

    // Each list-style option declares its own "unpin-zone:<style>" droppable so
    // dnd-kit doesn't see colliding IDs across mounted-but-hidden options.
    if (overId === "unpin-zone" || overId.startsWith("unpin-zone:")) {
      if (isCardSource) void unpin(documentId);
      return;
    }

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
      {children}
      <DragOverlay dropAnimation={null}>
        {activeGhost ? <DragGhost title={activeGhost.title} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

export function DragGhost({ title }: { title: string }) {
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
