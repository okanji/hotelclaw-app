import { queryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type {
  AssistantChat,
  AssistantProject,
  AssistantProjectResource,
} from "@/lib/assistant/types";

/**
 * React Query option factories for the Assistant section. Every read goes
 * through the user's RLS client, and the 0102 policies scope each table to
 * `user_id = auth.uid()` — so these deliberately do NOT add a user filter of
 * their own. A missed filter here would fail closed, not leak.
 *
 * Freshness is push-driven: `AssistantSection` subscribes to
 * `postgres_changes` on assistant_chats / assistant_projects and invalidates
 * these keys (house rule — never `refetchInterval`).
 */

const CHAT_COLUMNS =
  "id, title, project_id, eve_session_id, continuation_token, pinned, source, workflow_id, last_message_at, created_at";
const PROJECT_COLUMNS =
  "id, name, description, instructions, memory, emoji, tint, pinned, updated_at, created_at";

export const assistantChatsKey = (propertyId: string) =>
  ["assistant-chats", propertyId] as const;
export const assistantProjectsKey = (propertyId: string) =>
  ["assistant-projects", propertyId] as const;
export const assistantResourcesKey = (projectId: string) =>
  ["assistant-project-resources", projectId] as const;

/** Every live conversation, newest activity first — the sidebar's recents. */
export function assistantChatsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: assistantChatsKey(propertyId),
    queryFn: async (): Promise<AssistantChat[]> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("assistant_chats")
        .select(CHAT_COLUMNS)
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("last_message_at", { ascending: false })
        .limit(200);
      return (data ?? []) as AssistantChat[];
    },
    staleTime: 30_000,
  });
}

export function assistantProjectsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: assistantProjectsKey(propertyId),
    queryFn: async (): Promise<AssistantProject[]> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("assistant_projects")
        .select(PROJECT_COLUMNS)
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false });
      return (data ?? []) as AssistantProject[];
    },
    staleTime: 60_000,
  });
}

export function assistantResourcesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: assistantResourcesKey(projectId),
    queryFn: async (): Promise<AssistantProjectResource[]> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("assistant_project_resources")
        .select("id, kind, document_id, title, body, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      return (data ?? []) as AssistantProjectResource[];
    },
    staleTime: 60_000,
  });
}
