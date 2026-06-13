"use client";

import { DocBoardsSection } from "@/components/documents/doc-boards-section";

/** Team-shared pinned-doc boards on the dashboard — click-to-pin (no doc list to drag from). */
export function PinnedResourcesWidget({ propertyId }: { propertyId: string }) {
  return <DocBoardsSection propertyId={propertyId} pinMode="picker" />;
}
