"use client";

/**
 * Collaborative spreadsheet — Liveblocks Storage. Modeled on the upstream
 * example at:
 *   https://github.com/liveblocks/liveblocks/tree/main/examples/nextjs-spreadsheet-advanced
 *
 * Sheets share the documents table + Liveblocks room ID format with the
 * Tiptap doc editor; we branch on `documents.kind` in `<DocumentsSurface>`
 * to render this instead of `<DocumentEditor>`. The room itself carries
 * Liveblocks Storage rather than a Yjs doc — they're parallel APIs on the
 * same room.
 */

import { useEffect, useMemo, useState } from "react";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ClientSideSuspense,
  RoomProvider,
  useStorage,
} from "@liveblocks/react/suspense";
import { Loader2 } from "lucide-react";
import { roomIdForDocument } from "@/lib/liveblocks/rooms";
import { createInitialSpreadsheet } from "@/lib/spreadsheet/initial";
import {
  documentsTreeQueryOptions,
  type DocumentTreeRow,
} from "@/lib/query/section-queries";
import {
  DocumentBreadcrumbs,
  type DocumentCrumb,
} from "../documents/document-breadcrumbs";
import { DocumentLastEdited } from "../documents/document-last-edited";
import { DocumentRoomAvatarStack } from "../documents/document-presence-stack";
import { SheetSurface } from "./sheet-surface";
import { SheetTitleBar } from "./sheet-title-bar";

export function SheetEditor({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  const { data: tree, isLoading, isError } = useQuery({
    ...documentsTreeQueryOptions(propertyId),
    retry: 2,
  });

  if (isLoading) return <SheetSkeleton />;
  if (isError && !tree) return <SheetSkeleton />;
  if (!tree) return <SheetSkeleton />;

  const row = tree.find((d) => d.id === documentId);
  if (!row) notFound();

  const ancestors = ancestorsOf(tree, row);
  // `initialStorage` is only applied the first time a room is opened with
  // empty storage — so this builds a seeded grid for new sheets and is
  // ignored thereafter. Memo it so each render isn't generating fresh
  // LiveObjects (they'd be tossed by the RoomProvider, but it's wasted work).
  const initialStorage = useMemo(() => createInitialSpreadsheet(), []);

  return (
    <RoomProvider
      id={roomIdForDocument(propertyId, documentId)}
      initialPresence={{
        cursor: null,
        selectedTaskId: null,
        draggingTaskId: null,
        editingEventId: null,
        focusedDay: null,
        selectedCell: null,
        selectionRange: null,
        activeSheetId: null,
      }}
      initialStorage={initialStorage}
    >
      <ClientSideSuspense fallback={<SheetSkeleton />}>
        <SheetInner
          propertyId={propertyId}
          documentId={documentId}
          initialTitle={row.title}
          lastEditedBy={row.last_edited_by}
          updatedAt={row.updated_at}
          ancestors={ancestors}
        />
      </ClientSideSuspense>
    </RoomProvider>
  );
}

function ancestorsOf(
  tree: DocumentTreeRow[],
  doc: DocumentTreeRow,
): DocumentCrumb[] {
  const byId = new Map(tree.map((d) => [d.id, d]));
  const crumbs: DocumentCrumb[] = [];
  const seen = new Set<string>();
  let cursor = doc.parent_id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    crumbs.unshift({ id: node.id, title: node.title });
    cursor = node.parent_id;
  }
  return crumbs;
}

function SheetInner({
  propertyId,
  documentId,
  initialTitle,
  lastEditedBy,
  updatedAt,
  ancestors,
}: {
  propertyId: string;
  documentId: string;
  initialTitle: string;
  lastEditedBy: string | null;
  updatedAt: string;
  ancestors: DocumentCrumb[];
}) {
  // Block render until Storage has loaded — `useStorage` from the suspense
  // entrypoint will suspend, but the ClientSideSuspense above catches it.
  const ready = useStorage((root) => root.spreadsheet != null);
  const [showTimeoutSkeleton, setShowTimeoutSkeleton] = useState(false);

  useEffect(() => {
    if (ready) {
      setShowTimeoutSkeleton(false);
      return;
    }
    const t = setTimeout(() => setShowTimeoutSkeleton(true), 12_000);
    return () => clearTimeout(t);
  }, [ready]);

  if (!ready && !showTimeoutSkeleton) return <SheetSkeleton />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-background">
      <div className="flex shrink-0 items-center border-b border-border/60 bg-muted/20 px-6 py-1.5">
        <DocumentBreadcrumbs
          propertyId={propertyId}
          ancestors={ancestors}
          currentTitle={initialTitle}
        />
      </div>
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-muted/40 px-6 py-2">
        <SheetTitleBar
          documentId={documentId}
          initialTitle={initialTitle}
        />
        <div className="flex items-center gap-3">
          <DocumentLastEdited
            propertyId={propertyId}
            lastEditedBy={lastEditedBy}
            updatedAt={updatedAt}
            className="hidden text-sm text-muted-foreground tabular-nums sm:block"
          />
          <DocumentRoomAvatarStack max={5} size={28} />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <SheetSurface documentId={documentId} />
      </div>
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading spreadsheet…
    </div>
  );
}
