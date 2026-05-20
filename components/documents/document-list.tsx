"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileText, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocumentListSkeleton } from "./document-list-skeleton";
import { documentsQueryOptions } from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";
import { usePinnedDocs } from "@/lib/documents/use-pinned-docs";

/**
 * "All documents" list — flat, most-recently-updated first. Used standalone
 * as one section of the docs Home page (`<DocumentsHome>`), which owns the
 * page-level header and the New-document control. The page's RSC stays
 * trivial: it streams the list in via `<HydrationBoundary>` and this hook
 * picks it up from the shared `["documents", propertyId]` cache.
 */
export function DocumentList({ propertyId }: { propertyId: string }) {
  const { data: docs, isPending } = useQuery(
    documentsQueryOptions(propertyId),
  );
  const { isPinned, togglePin } = usePinnedDocs(propertyId);
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);

  // Plain left-click → client-side `pushState` switch (no route nav, no
  // skeleton). Modified clicks fall through to the browser so "open in new
  // tab" still works via the underlying `<a href>`.
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, docId: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(docId);
  }

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
      {list.map((d) => {
        const pinned = isPinned(d.id);
        return (
          <li key={d.id} className="group/row relative">
            <Link
              href={documentHref(propertyId, d.id)}
              onClick={(e) => handleClick(e, d.id)}
              onMouseEnter={() => prewarm(d.id)}
              className="flex items-center gap-3 px-4 py-3 pr-14 group-hover/row:bg-muted/50"
            >
              <FileText className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate text-sm font-medium">
                {d.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(d.updated_at).toLocaleDateString()}
              </span>
            </Link>
            {/* Pin toggle sits outside the <Link>, so clicking it doesn't
                navigate — DOM click targets this button, not the anchor
                underneath. Pinned rows keep the icon visible; unpinned rows
                only show it on row hover/focus. */}
            <button
              type="button"
              aria-label={pinned ? "Unpin document" : "Pin document"}
              title={pinned ? "Unpin" : "Pin"}
              onClick={() => togglePin(d.id)}
              className={cn(
                "absolute right-3 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md transition",
                pinned
                  ? "text-foreground opacity-100 hover:bg-muted"
                  : "text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100",
              )}
            >
              <Pin
                className={cn("size-3.5", pinned && "fill-current")}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
