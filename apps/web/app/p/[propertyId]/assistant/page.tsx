import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AssistantWorkspace } from "@/components/assistant/assistant-workspace";
import type { AssistantChat } from "@/lib/assistant/types";

/**
 * The Assistant surface — a tabbed personal chat over the whole workspace.
 *
 * The server's job is exactly the first frame: the conversation list, plus
 * which tabs were open (an `assistant_tabs` cookie, the same trick the shell
 * uses for `sidebar_collapsed` — restoring it client-side would flash an
 * empty strip). Everything after that is client state, because a tab switch
 * must not cost a round trip.
 *
 * RLS scopes these rows to the signed-in user (migration 0102), so there is
 * deliberately no user filter here: a mistake fails closed.
 */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ c?: string; send?: string }>;
}) {
  const { propertyId } = await params;
  const { c: activeId, send } = await searchParams;
  const supabase = await createClient();

  const { data: chats } = await supabase
    .from("assistant_chats")
    .select(
      "id, title, project_id, eve_session_id, continuation_token, pinned, source, workflow_id, last_message_at, created_at",
    )
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(200);

  const live = new Set((chats ?? []).map((chat) => chat.id));
  const cookieStore = await cookies();
  // A chat archived or deleted since the cookie was written is dropped here,
  // so a stale tab can never render an empty pane.
  // decodeURIComponent defensively: cookies written before the client stopped
  // encoding the separator arrive as one `%2C`-joined blob, and this turns
  // them back into ids rather than silently dropping the whole strip.
  const restored = decodeURIComponent(cookieStore.get("assistant_tabs")?.value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id && live.has(id));
  const openIds =
    activeId && live.has(activeId) && !restored.includes(activeId)
      ? [...restored, activeId]
      : restored;

  return (
    <AssistantWorkspace
      propertyId={propertyId}
      initialChats={(chats ?? []) as AssistantChat[]}
      initialOpenIds={openIds}
      initialActiveId={
        activeId && openIds.includes(activeId) ? activeId : (openIds[0] ?? null)
      }
      initialSend={send ?? null}
    />
  );
}
