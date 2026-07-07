"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { documentHref } from "./document-href";

/**
 * Pathnames that mount the persistent `<DocumentsSurface>`. Inside them, doc
 * navigation is a client-side `pushState`; arriving from another section is a
 * real `router.push`. Both `documents/page.tsx` and
 * `documents/[documentId]/page.tsx` render `null`, so the surface fully owns
 * rendering and pushState works for index ↔ doc and doc ↔ doc transitions.
 */
const IN_DOCS_SURFACE = /^\/p\/[^/]+\/documents(?:\/|$)/;

/**
 * Opens a document.
 *
 * When the user is already on a `/documents/[id]` route, this is a pure
 * `window.history.pushState` — no Next route navigation, no RSC round-trip,
 * no `loading.tsx` flash. The persistent surface re-renders, `<DocumentEditor>`
 * remounts with the new id (clean Tiptap + Liveblocks state per doc), and the
 * editor binds to the new Yjs doc. Called from outside the section (or from
 * the `/documents` index), it falls back to a normal `router.push`.
 *
 * Single chokepoint for doc navigation, mirroring `documentHref`.
 */
export function useOpenDocument(propertyId: string) {
  const router = useRouter();
  return useCallback(
    (documentId: string) => {
      const href = documentHref(propertyId, documentId);
      if (IN_DOCS_SURFACE.test(window.location.pathname)) {
        window.history.pushState(null, "", href);
        // `usePathname` does not update on `pushState` — surfaces listen for
        // this so client-side doc switches re-render without a route nav.
        window.dispatchEvent(new Event("hotelclaw:pathname"));
      } else {
        router.push(href);
      }
    },
    [propertyId, router],
  );
}
