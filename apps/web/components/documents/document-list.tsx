"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { DocumentListSkeleton } from "./document-list-skeleton";
import { DocumentRow } from "./document-row";
import { EmptyState } from "@/components/ui/empty-state";
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
      <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Could not load documents
        {error instanceof Error ? `: ${error.message}` : "."}
      </div>
    );
  }

  const list = docs ?? [];
  if (list.length === 0) {
    return (
      <EmptyState icon={FileText} title="No documents yet" />
    );
  }

  return (
    <ul role="list" className="flex flex-col gap-px">
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
