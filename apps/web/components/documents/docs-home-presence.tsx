"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { presenceByDocumentId } from "@/lib/documents/build-activity";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  documentBoardsQueryOptions,
  documentPresenceQueryOptions,
  documentsQueryOptions,
  type DocumentPresenceUser,
} from "@/lib/query/section-queries";

const PresenceContext = createContext<Map<string, DocumentPresenceUser[]>>(
  new Map(),
);

/**
 * Polls Liveblocks for viewers on docs visible on the home page (library +
 * board pins). One query shared by cards, rows, and the activity panel.
 */
export function DocsHomePresenceProvider({
  propertyId,
  children,
}: {
  propertyId: string;
  children: React.ReactNode;
}) {
  const { data: docs = [] } = useQuery(documentsQueryOptions(propertyId));
  const { data: boards = [] } = useQuery(documentBoardsQueryOptions(propertyId));

  const trackedDocIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of docs) ids.add(d.id);
    for (const b of boards) {
      for (const i of b.items) ids.add(i.document_id);
    }
    return [...ids].slice(0, 15);
  }, [docs, boards]);

  const { data: presence = [] } = useQuery(
    documentPresenceQueryOptions(propertyId, trackedDocIds),
  );

  const queryClient = useQueryClient();
  useEffect(() => {
    const supabase = createBrowserClient();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["documents", propertyId] });
      queryClient.invalidateQueries({
        queryKey: ["document-boards", propertyId],
      });
    };
    const channel = supabase
      .channel(`docs-home-activity:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `property_id=eq.${propertyId}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_boards" },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_board_items" },
        invalidate,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, queryClient]);

  const byDocId = useMemo(
    () => presenceByDocumentId(presence),
    [presence],
  );

  return (
    <PresenceContext.Provider value={byDocId}>
      {children}
    </PresenceContext.Provider>
  );
}

export function useDocsHomePresenceMap() {
  return useContext(PresenceContext);
}

export function useDocsHomePresence(documentId: string) {
  const map = useContext(PresenceContext);
  return map.get(documentId) ?? [];
}
