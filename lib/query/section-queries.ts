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
        .select("id, title, parent_id, position, updated_at")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentTreeRow[];
    },
  });
}
