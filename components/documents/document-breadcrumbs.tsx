"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type DocumentCrumb = { id: string; title: string };

/**
 * Ancestor trail shown at the top of a document. `All documents` → each
 * parent → the current page. Parents are links; the current page is the
 * (live-updating) leaf. Rendered by `DocumentEditor`.
 */
export function DocumentBreadcrumbs({
  propertyId,
  ancestors,
  currentTitle,
}: {
  propertyId: string;
  ancestors: DocumentCrumb[];
  currentTitle: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-0.5 text-xs text-muted-foreground"
    >
      <Link
        href={`/p/${propertyId}/documents`}
        className="shrink-0 rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
      >
        All documents
      </Link>
      {ancestors.map((crumb) => (
        <span key={crumb.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight className="size-3 shrink-0 opacity-50" />
          <Link
            href={`/p/${propertyId}/documents/${crumb.id}`}
            className="truncate rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            {crumb.title || "Untitled"}
          </Link>
        </span>
      ))}
      <ChevronRight className="size-3 shrink-0 opacity-50" />
      <span className="truncate px-1.5 py-0.5 font-medium text-foreground">
        {currentTitle || "Untitled"}
      </span>
    </nav>
  );
}
