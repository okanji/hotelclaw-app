"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocumentListSkeleton } from "./document-list-skeleton";
import { documentsQueryOptions } from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";

type DocRow = { id: string; title: string; updated_at: string };

/**
 * "All documents" list — flat, most-recently-updated first. Renders inside
 * `<DocumentsHome>`'s `<DndContext>`, so each row is a `useDraggable` source:
 * dragging onto a board card or board strip pins the doc; dnd-kit's
 * activation distance (6px) means a plain click still navigates.
 */
export function DocumentList({ propertyId }: { propertyId: string }) {
  const { data: docs, isPending } = useQuery(
    documentsQueryOptions(propertyId),
  );

  // First streamed render before the hydrated list lands.
  if (isPending) return <DocumentListSkeleton />;

  const list = docs ?? [];
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <FileText className="size-7 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {list.map((d) => (
        <DocumentListRow key={d.id} doc={d} propertyId={propertyId} />
      ))}
    </ul>
  );
}

function DocumentListRow({
  doc,
  propertyId,
}: {
  doc: DocRow;
  propertyId: string;
}) {
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);

  // Drag source: id `doc:<id>` — the parent DndContext's `onDragEnd`
  // dispatches based on this prefix.
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `doc:${doc.id}`,
      data: { type: "doc", documentId: doc.id },
    });

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(doc.id);
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      className={cn(
        "group/row relative cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(doc.id)}
        draggable={false}
        className="flex items-center gap-3 px-4 py-3 group-hover/row:bg-muted/50"
      >
        <FileText className="size-4 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">
          {doc.title}
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(doc.updated_at).toLocaleDateString()}
        </span>
      </Link>
    </li>
  );
}
