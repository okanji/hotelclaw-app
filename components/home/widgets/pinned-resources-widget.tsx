"use client";

import { DocBoardsSection } from "@/components/documents/doc-boards-section";
import { DocBoardsBoard } from "@/components/documents/doc-boards-board";

/** The team-shared pinned-doc boards, reused from the Docs home. Wrapped in its
 *  own `DocBoardsBoard` so drag-to-pin works inside the dashboard exactly as it
 *  does on the Docs Directory. Wide widget — the strips scroll horizontally. */
export function PinnedResourcesWidget({ propertyId }: { propertyId: string }) {
  return (
    <DocBoardsBoard propertyId={propertyId}>
      <DocBoardsSection propertyId={propertyId} />
    </DocBoardsBoard>
  );
}
