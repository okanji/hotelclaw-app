"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DocumentEditor } from "@/components/documents/document-editor";
import { useArtifactPanel } from "./artifact-panel-context";

/**
 * The chat's split-screen artifact view — a wide right-side sheet hosting
 * the REAL document editor bound to the doc's Liveblocks room. Because the
 * AI's writes are transactional Liveblocks edits, an open panel shows the
 * document being written section-by-section in realtime (and the viewer
 * can edit alongside — it's the same collaborative room).
 *
 * Mounted per-property (needs the /p/[propertyId] Liveblocks auth layout);
 * opened from artifact cards in messages (artifact-card.tsx).
 */
export function ArtifactSidePanel({ propertyId }: { propertyId: string }) {
  const { target, close } = useArtifactPanel();

  return (
    <Sheet open={target !== null} onOpenChange={(o) => (o ? null : close())}>
      <SheetContent
        side="right"
        className="flex w-[min(92vw,780px)] flex-col gap-0 p-0 sm:max-w-[780px]"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm">
            {target?.title ?? "Document"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Live view of the document the AI is working on.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {target?.kind === "document" ? (
            <DocumentEditor
              key={target.documentId}
              propertyId={propertyId}
              documentId={target.documentId}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
