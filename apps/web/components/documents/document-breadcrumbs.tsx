"use client";

import Link from "next/link";
import { ChevronLeft, FileText } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";

export type DocumentCrumb = { id: string; title: string };

/**
 * Back chevron for the native mobile shell only — hidden everywhere else
 * (`.hc-embed-back`, globals.css). The app's document screen hides its native
 * stack header and promotes the editor's top row to be THE bar, so that row
 * needs a way to pop the native stack: the shell's WebSurface listens for
 * this message in `onMessage`. Rendered by both the doc and sheet editors,
 * immediately before their breadcrumbs.
 */
export function EmbedBackButton() {
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() =>
        (
          window as unknown as {
            ReactNativeWebView?: { postMessage(msg: string): void };
          }
        ).ReactNativeWebView?.postMessage(JSON.stringify({ type: "back" }))
      }
      className="hc-embed-back ibtn"
    >
      <Gi icon={ChevronLeft} size={18} />
    </button>
  );
}

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

  // gr8r `.crumbs` (the topbar trail): `.crumb` links, `.sep` slashes and
  // the `.cur` leaf. In narrow containers (mobile WebView, the chat's
  // artifact side panel — hence the `doceditor` container, not viewport
  // breakpoints) the trail is noise — only the leaf title survives.
  return (
    <nav aria-label="Breadcrumb" className="crumbs trunc">
      <Link
        href={`/p/${propertyId}/documents`}
        className="crumb @max-3xl/doceditor:hidden"
      >
        <Gi icon={FileText} size={14} />
        Docs
      </Link>
      {ancestors.map((crumb) => (
        <span key={crumb.id} className="contents">
          <span aria-hidden="true" className="sep @max-3xl/doceditor:hidden">
            /
          </span>
          <Link
            href={documentHref(propertyId, crumb.id)}
            onClick={(e) => handleAncestorClick(e, crumb.id)}
            className="crumb trunc @max-3xl/doceditor:hidden"
            style={{ maxWidth: 200 }}
          >
            {crumb.title || "Untitled"}
          </Link>
        </span>
      ))}
      <span aria-hidden="true" className="sep @max-3xl/doceditor:hidden">
        /
      </span>
      <span className="crumb cur trunc">{currentTitle || "Untitled"}</span>
    </nav>
  );
}
