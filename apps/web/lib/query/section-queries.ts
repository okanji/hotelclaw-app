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

import type { TaskDetailMeta } from "@/lib/tasks/task-detail-meta";
import type { PropertyChannel } from "@/lib/chat/channels";

export function taskDetailMetaQueryOptions(propertyId: string, taskId: string) {
  return queryOptions({
    queryKey: ["task-meta", propertyId, taskId] as const,
    queryFn: async (): Promise<TaskDetailMeta> => {
      const res = await fetch(
        `/api/properties/${propertyId}/tasks/${taskId}/meta`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load task details");
      return res.json();
    },
  });
}

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

export function channelsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["channels", propertyId] as const,
    queryFn: async (): Promise<PropertyChannel[]> => {
      const res = await fetch(`/api/properties/${propertyId}/channels`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load channels");
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
  // 'doc' = Tiptap rich-text; 'sheet' = collaborative spreadsheet. Drives
  // the editor fork in <DocumentsSurface> and the icon in the tree.
  kind: "doc" | "sheet";
  /** Creation provenance (migration 0050) — 'workflow' docs get a ⚡ badge.
   *  Optional so optimistic cache inserts don't have to supply them. */
  source?: string | null;
  source_workflow_id?: string | null;
  source_workflow_run_id?: string | null;
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
        .select(
          "id, title, parent_id, position, updated_at, last_edited_by, kind, source, source_workflow_id, source_workflow_run_id",
        )
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentTreeRow[];
    },
  });
}

/** A task linked to a document — the doc-side backlink (see migration 0033). */
export type LinkedTask = {
  /** `task_document_links.id` — used to unlink. */
  linkId: string;
  id: string;
  title: string;
  status: string;
};

/**
 * Tasks that reference `documentId`, via `task_document_links`. The document
 * editor's "Linked tasks" panel reads this; the task side already shows the
 * inverse (a task's linked docs). Two-step (links → tasks) to dodge the nested-
 * join typing, mirroring `lib/tasks/task-detail-meta.ts`. RLS scopes both reads.
 */
export function documentLinkedTasksQueryOptions(
  propertyId: string,
  documentId: string,
) {
  return queryOptions({
    queryKey: ["doc-linked-tasks", propertyId, documentId] as const,
    queryFn: async (): Promise<LinkedTask[]> => {
      const supabase = createBrowserClient();
      const { data: links, error } = await supabase
        .from("task_document_links")
        .select("id, task_id")
        .eq("document_id", documentId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = links ?? [];
      if (rows.length === 0) return [];

      const linkIdByTaskId = new Map(rows.map((r) => [r.task_id, r.id]));
      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select("id, title, status")
        .in("id", [...linkIdByTaskId.keys()]);
      if (tasksError) throw new Error(tasksError.message);

      return (tasks ?? []).map((t) => ({
        linkId: linkIdByTaskId.get(t.id)!,
        id: t.id,
        title: t.title,
        status: t.status,
      }));
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

export type FormSidebarItem = {
  id: string;
  title: string;
  icon: string | null;
  status: string;
  updated_at: string;
};

/** Lightweight form index for the Documents-section sidebar. */
export function formsListQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["forms", propertyId] as const,
    queryFn: async (): Promise<FormSidebarItem[]> => {
      const res = await fetch(`/api/properties/${propertyId}/forms`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load forms");
      return res.json();
    },
  });
}
