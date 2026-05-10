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
  messageId: string;
  byUserId: string;
  byUserName: string | null;
  preview: string;
};
