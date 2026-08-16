"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";

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
  const openDocument = useOpenDocument(propertyId);

  // Plain left-click on an ancestor → client-side `pushState`. "All documents"
  // (the index link) stays as a normal `<Link>` — modified clicks on either
  // still open in a new tab via the `<a href>`.
  function handleAncestorClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    crumbId: string,
  ) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(crumbId);
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-0.5 text-xs text-faint-foreground"
    >
      {/* In narrow containers (mobile WebView, the chat's artifact side
          panel — hence the `doceditor` container, not viewport breakpoints)
          the trail is noise — only the leaf title survives. */}
      <Link
        href={`/p/${propertyId}/documents`}
        className="shrink-0 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent @max-3xl/doceditor:hidden"
      >
        All documents
      </Link>
      {ancestors.map((crumb) => (
        <span
          key={crumb.id}
          className="flex min-w-0 items-center gap-0.5 @max-3xl/doceditor:hidden"
        >
          <ChevronRight className="size-3 shrink-0 opacity-50" />
          <Link
            href={documentHref(propertyId, crumb.id)}
            onClick={(e) => handleAncestorClick(e, crumb.id)}
            className="truncate rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent"
          >
            {crumb.title || "Untitled"}
          </Link>
        </span>
      ))}
      <ChevronRight className="size-3 shrink-0 opacity-50 @max-3xl/doceditor:hidden" />
      <span className="truncate px-1.5 py-0.5 font-medium text-foreground">
        {currentTitle || "Untitled"}
      </span>
    </nav>
  );
}
