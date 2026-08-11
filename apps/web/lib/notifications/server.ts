import "server-only";
import { createServiceClient, type createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Recognized notification types. Adding a new type? Add it here AND give the
 * client UI an icon + render in `components/shell/notification-feed.tsx`.
 */
export type NotificationType =
  | "task_assigned"
  | "task_unassigned"
  | "channel_added"
  | "invite_received"
  | "invite_access_requested"
  | "mention"
  | "task_comment_mention"
  | "meeting_summary"
  | "workflow"
  | "briefing"
  | "project_at_risk"
  | "task_slip"
  | "insight_alert"
  | "guest_escalation"
  | "task_escalated"
  | "ai_message";

export type NotificationPayload = Record<string, unknown>;

type Args = {
  userId: string;
  propertyId?: string | null;
  type: NotificationType;
  payload?: NotificationPayload;
};

/**
 * Insert a notification row using the service-role client. Callers must
 * already trust the `userId` they're notifying — this is server-only and
 * not exposed via any API.
 *
 * Never throws; logs and returns on failure. Failing to deliver a
 * notification should never block the action that triggered it.
 */
export async function createNotification(args: Args): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service.from("notifications").insert({
      user_id: args.userId,
      property_id: args.propertyId ?? null,
      type: args.type,
      payload: args.payload ?? {},
    });
    if (error) {
      console.error("createNotification failed", error.message);
    }
  } catch (e) {
    console.error("createNotification threw", e);
  }
}

export async function createNotifications(items: Args[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const service = createServiceClient();
    const { error } = await service.from("notifications").insert(
      items.map((a) => ({
        user_id: a.userId,
        property_id: a.propertyId ?? null,
        type: a.type,
        payload: a.payload ?? {},
      })),
    );
    if (error) {
      console.error("createNotifications failed", error.message);
    }
  } catch (e) {
    console.error("createNotifications threw", e);
  }
}

/**
 * Returns the subset of `userIds` who already have a notification of `type`
 * matching `payload[match.key] === match.value` in the last 24 hours. Used
 * by both the client-side bridge and the Stream webhook to avoid duplicate
 * notifications when both fire for the same message — whichever lands first
 * wins, the other's user ids are filtered out here.
 *
 * Cheap query via the (user_id, created_at) index; the payload JSON contains
 * check is a sequential scan over the recent window only.
 */
/**
 * The current user's latest notifications, newest first (RLS scopes by
 * user_id). Shared by `GET /api/me/notifications` and the server-side
 * prefetch in the property layout — same shape under `["notifications", id]`.
 *
 * Pass the *user-scoped* client (`createClient()`), not the service client.
 */
export async function getNotifications(
  supabase: ServerClient,
  opts: { limit?: number; unseenOnly?: boolean } = {},
) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  let q = supabase
    .from("notifications")
    .select("id, type, payload, property_id, seen_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.unseenOnly) q = q.is("seen_at", null);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function findAlreadyNotifiedUserIds(args: {
  userIds: string[];
  type: NotificationType;
  match: { key: string; value: string };
}): Promise<Set<string>> {
  if (args.userIds.length === 0) return new Set();
  const service = createServiceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await service
    .from("notifications")
    .select("user_id")
    .in("user_id", args.userIds)
    .eq("type", args.type)
    .gte("created_at", since)
    .contains("payload", { [args.match.key]: args.match.value });
  return new Set((data ?? []).map((r) => r.user_id as string));
}
