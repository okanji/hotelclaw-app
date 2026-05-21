import { queryOptions } from "@tanstack/react-query";
import type { StreamChat } from "stream-chat";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { Task } from "@/components/tasks/kanban";
import type { DocumentListItem } from "@/lib/documents/queries";

/**
 * React Query option factories for the data behind each rail section.
 *
 * Shared by the section's own component AND the rail's warm prefetch
 * (`components/shell/app-rail.tsx`), so the query key + fetcher are defined
 * once and can never drift between the consumer and the prefetch.
 */

export function tasksQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["tasks", propertyId] as const,
    queryFn: async (): Promise<Task[]> => {
      const res = await fetch(`/api/properties/${propertyId}/tasks`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load tasks");
      return res.json();
    },
  });
}

export function documentsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["documents", propertyId] as const,
    queryFn: async (): Promise<DocumentListItem[]> => {
      const res = await fetch(`/api/properties/${propertyId}/documents`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
  });
}

export function mentionsQueryOptions(
  propertyId: string,
  userId: string,
  client: StreamChat | undefined,
) {
  return queryOptions({
    queryKey: ["mentions", propertyId, userId] as const,
    // The search runs over the Stream client; only fetch once it's connected.
    // Hydrated data still displays before then.
    enabled: !!client?.user,
    queryFn: async () => {
      const res = await client!.search(
        {
          type: { $in: ["team", "messaging"] },
          property_id: propertyId,
          members: { $in: [client!.user!.id] },
        } as Parameters<StreamChat["search"]>[0],
        { "mentioned_users.id": { $contains: client!.user!.id } },
        { limit: 50, sort: [{ created_at: -1 }] },
      );
      return res.results ?? [];
    },
  });
}

/** A flat documents row — the secondary-sidebar tree is built from these. */
export type DocumentTreeRow = {
  id: string;
  title: string;
  parent_id: string | null;
  position: number;
  updated_at: string;
  last_edited_by: string | null;
};

/**
 * Flat list of the property's active documents, position-ordered — the
 * `DocumentsTreeSection` sidebar builds its nested tree from this, and
 * `DocumentEditor` derives its breadcrumb ancestors from the same cache.
 * Fetches directly via the browser Supabase client (RLS scopes the rows).
 */
export function documentsTreeQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["documents-tree", propertyId] as const,
    queryFn: async (): Promise<DocumentTreeRow[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, parent_id, position, updated_at, last_edited_by")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentTreeRow[];
    },
  });
}

/** Display accents for boards — kept in sync with the CHECK in migration 0013. */
export const BOARD_COLORS = [
  "slate",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

export type DocumentBoardItem = {
  document_id: string;
  position: number;
  created_at: string;
};

/** A board row from `document_boards`, with its items inlined for one-query render. */
export type DocumentBoardRow = {
  id: string;
  name: string;
  color: BoardColor;
  position: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  items: DocumentBoardItem[];
};

export type PropertyMember = {
  id: string;
  role: string;
  name: string | null;
  avatarUrl: string | null;
};

export type DocumentPresenceUser = {
  id: string;
  name: string;
  avatar?: string;
};

export type DocumentPresenceEntry = {
  documentId: string;
  users: DocumentPresenceUser[];
};

/**
 * All boards for a property, position-ordered, each with its (document_id,
 * position) items inlined. Drives the Boards strip at the top of the docs
 * home; the consuming component resolves item ids against the
 * `documentsQueryOptions` cache to render real titles + meta.
 */
export function documentBoardsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["document-boards", propertyId] as const,
    queryFn: async (): Promise<DocumentBoardRow[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/document-boards`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load document boards");
      return res.json();
    },
  });
}

export function propertyMembersQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["property-members", propertyId] as const,
    queryFn: async (): Promise<PropertyMember[]> => {
      const res = await fetch(`/api/properties/${propertyId}/members`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load members");
      return res.json();
    },
  });
}

/** Live viewers per document room — polled on the docs home (max 15 ids). */
export function documentPresenceQueryOptions(
  propertyId: string,
  documentIds: string[],
) {
  const ids = [...documentIds].sort().join(",");
  return queryOptions({
    queryKey: ["document-presence", propertyId, ids] as const,
    enabled: documentIds.length > 0,
    queryFn: async (): Promise<DocumentPresenceEntry[]> => {
      const params = new URLSearchParams({ ids: documentIds.join(",") });
      const res = await fetch(
        `/api/properties/${propertyId}/documents/presence?${params}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load document presence");
      return res.json();
    },
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
}
