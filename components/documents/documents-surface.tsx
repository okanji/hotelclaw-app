"use client";

import { usePathname } from "next/navigation";
import { DocumentEditor } from "./document-editor";
import { DocumentsHome } from "./documents-home";
import { RecentDocsRecorder } from "./recent-docs-recorder";

/** Any URL under the docs section — used to gate the surface OFF other sections. */
const IN_DOCS = /^\/p\/[^/]+\/documents(?:\/|$)/;
/** Captures the document id from `/p/<pid>/documents/<id>`. */
const DOC_ROUTE = /^\/p\/[^/]+\/documents\/([^/]+)\/?$/;

/**
 * Persistent docs surface — mounted in the property layout, so the guard
 * below is critical: WITHOUT it the no-`documentId` branch would render
 * `<DocumentsHome>` on every non-docs URL (e.g. on top of the chat pane).
 *
 * Reads the active document straight from the URL (via `usePathname` —
 * that's what `window.history.pushState` updates, unlike `useParams` which
 * only fires on real navigations). Switching docs via `useOpenDocument`
 * re-renders this in place with no route navigation, no `loading.tsx` flash.
 *
 * `<DocumentEditor key={documentId}>` forces a clean per-doc mount so the
 * Liveblocks `RoomProvider`'s `useState` initializer captures the new room on
 * the first render — without that, the new Tiptap editor would briefly bind
 * to the *previous* doc's Yjs.
 */
export function DocumentsSurface({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  // Only render under `/documents/*` — the surface is now mounted property-
  // wide, so this check is the *section gate*, not a no-op.
  if (!IN_DOCS.test(pathname)) return null;

  const documentId = pathname.match(DOC_ROUTE)?.[1];
  if (documentId) {
    return (
      <>
        {/* Records this open into the per-property recents list so the Home
            page can surface it. No render; effect-only. */}
        <RecentDocsRecorder propertyId={propertyId} documentId={documentId} />
        <DocumentEditor
          key={documentId}
          propertyId={propertyId}
          documentId={documentId}
        />
      </>
    );
  }
  return <DocumentsHome propertyId={propertyId} />;
}
