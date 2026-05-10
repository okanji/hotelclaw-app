import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Recognized notification types. Adding a new type? Add it here AND give the
 * client UI an icon + render in `components/shell/notification-feed.tsx`.
 */
export type NotificationType =
  | "task_assigned"
  | "task_unassigned"
  | "channel_added"
  | "invite_received"
  | "mention";

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
