"use client";

import { useEffect } from "react";
import { recordRecentDoc } from "@/lib/documents/use-recent-docs";

/**
 * Records the open document as a "recently opened" entry (localStorage) so
 * the docs Home page can surface it. Renders nothing — mounted by the doc
 * route alongside `<DocumentEditor>`, so every open path (sidebar click,
 * breadcrumb, deep link, search jump) records here.
 */
export function RecentDocsRecorder({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  useEffect(() => {
    recordRecentDoc(propertyId, documentId);
  }, [propertyId, documentId]);

  return null;
}
