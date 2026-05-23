"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { DocumentListSkeleton } from "./document-list-skeleton";
import { DocumentRow } from "./document-row";
import { documentsQueryOptions } from "@/lib/query/section-queries";

/**
 * "All documents" list — flat, most-recently-updated first. Renders inside
 * `<DocumentsHome>`'s `<DndContext>`, so each row is a `useDraggable` source:
 * dragging onto a board card or board strip pins the doc; dnd-kit's
 * activation distance (6px) means a plain click still navigates.
 */
export function DocumentList({ propertyId }: { propertyId: string }) {
  const { data: docs, isPending, isError, error } = useQuery(
    documentsQueryOptions(propertyId),
  );

  // First streamed render before the hydrated list lands.
  if (isPending) return <DocumentListSkeleton />;

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Could not load documents
        {error instanceof Error ? `: ${error.message}` : "."}
      </div>
    );
  }

  const list = docs ?? [];
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 px-6 py-10 text-center">
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

  return (
    <ul role="list" className="flex flex-col gap-0.5">
      {list.map((d) => (
        <DocumentRow
          key={d.id}
          propertyId={propertyId}
          doc={d}
          draggable
        />
      ))}
    </ul>
  );
}
