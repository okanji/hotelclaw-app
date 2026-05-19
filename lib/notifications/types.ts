/**
 * Client-side types for notification payloads. Keep in sync with the
 * server-side `NotificationType` union in `lib/notifications/server.ts`.
 */

export type NotificationRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  property_id: string | null;
  seen_at: string | null;
  created_at: string;
};

export type TaskAssignedPayload = {
  taskId: string;
  taskTitle: string;
  byUserId: string;
  byUserName: string | null;
};

export type ChannelAddedPayload = {
  channelId: string;
  channelName: string;
  byUserId: string;
  byUserName: string | null;
};

export type InviteReceivedPayload = {
  inviteToken: string;
  propertyName: string;
  role: string;
};

export type MentionPayload = {
  channelId: string;
  /** Stream channel type — `"messaging"` for a DM, `"team"` for a channel.
   *  Decides whether the deep link routes to `/dms` or `/chat`. Optional:
   *  notifications written before this field existed won't carry it, and
   *  consumers fall back to treating those as team channels. */
  channelType?: "team" | "messaging";
  messageId: string;
  byUserId: string;
  byUserName: string | null;
  preview: string;
};
