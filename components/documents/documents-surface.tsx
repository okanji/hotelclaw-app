"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SheetEditor } from "@/components/spreadsheet/sheet-editor";
import { documentsTreeQueryOptions } from "@/lib/query/section-queries";
import { DocumentEditor } from "./document-editor";
import { DocumentsHome } from "./documents-home";

/** Any URL under the docs section — used to gate the surface OFF other sections. */
const IN_DOCS = /^\/p\/[^/]+\/documents(?:\/|$)/;
/** Captures the document id from `/p/<pid>/documents/<id>`. */
const DOC_ROUTE = /^\/p\/[^/]+\/documents\/([^/]+)\/?$/;

/**
 * Persistent docs surface — mounted in the property layout, so the guard
 * below is critical: WITHOUT it the no-`documentId` branch would render
 * `<DocumentsHome>` on every non-docs URL (e.g. on top of the chat pane).
 *
 * Reads the active document from the URL. Real navigations update via
 * `usePathname`; in-section `pushState` switches sync through
 * `hotelclaw:pathname` / `popstate` (see below). Switching docs via
 * `useOpenDocument`
 * re-renders this in place with no route navigation, no `loading.tsx` flash.
 *
 * `<DocumentEditor key={documentId}>` forces a clean per-doc mount so the
 * Liveblocks `RoomProvider`'s `useState` initializer captures the new room on
 * the first render — without that, the new Tiptap editor would briefly bind
 * to the *previous* doc's Yjs.
 */
export function DocumentsSurface({ propertyId }: { propertyId: string }) {
  const nextPathname = usePathname();
  // `usePathname` only updates on real Next navigations. Doc switches inside
  // the section use `pushState`, so mirror `window.location` on popstate too.
  const [pathname, setPathname] = useState(nextPathname);
  useEffect(() => {
    setPathname(nextPathname);
  }, [nextPathname]);
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    window.addEventListener("hotelclaw:pathname", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hotelclaw:pathname", sync);
    };
  }, []);

  // Only render under `/documents/*` — the surface is now mounted property-
  // wide, so this check is the *section gate*, not a no-op.
  if (!IN_DOCS.test(pathname)) return null;

  const documentId = pathname.match(DOC_ROUTE)?.[1];
  if (documentId) {
    return (
      <ActiveDocument
        key={documentId}
        propertyId={propertyId}
        documentId={documentId}
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocumentsHome propertyId={propertyId} />
    </div>
  );
}

/**
 * Reads `documents.kind` out of the warm tree cache and renders the right
 * editor. We don't have a separate Postgres roundtrip for this — the layout's
 * prefetch + the rail's realtime keep this query fresh, so the branch is
 * effectively synchronous.
 *
 * While the cache is cold (hard load that hasn't hydrated yet) we render the
 * rich-text editor — it does its own loading + 404 handling internally.
 * Once the kind shows up we swap.
 */
function ActiveDocument({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  const { data: tree } = useQuery({
    ...documentsTreeQueryOptions(propertyId),
    retry: 2,
  });
  const row = tree?.find((d) => d.id === documentId);
  if (row?.kind === "sheet") {
    return <SheetEditor propertyId={propertyId} documentId={documentId} />;
  }
  return <DocumentEditor propertyId={propertyId} documentId={documentId} />;
}
