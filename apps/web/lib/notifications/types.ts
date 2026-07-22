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

export type TaskEscalatedPayload = {
  taskId: string;
  taskTitle: string;
  byUserId: string;
  byUserName: string | null;
  /** How this person is on the hook — their direct report, or their team. */
  reason: "manager" | "team_lead";
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

/** Someone hit the wrong-account wall on an invite you sent, and told you the
 *  address they actually use. */
export type InviteAccessRequestedPayload = {
  requestedBy: string;
  requesterName: string | null;
  requesterEmail: string;
  /** The address the invite was originally sent to. */
  invitedEmail: string;
  propertyName: string;
};

export type MentionPayload = {
  channelId: string;
  /** Stream channel type — `"messaging"` for a DM, `"team"` for a channel.
   *  Decides whether the deep link routes to `/dms` or `/chat`. Optional:
   *  notifications written before this field existed won't carry it, and
   *  consumers fall back to treating those as team channels. */
  channelType?: "team" | "messaging";
  /** Display name of the team channel, for the activity feed's `#channel`
   *  chip. Optional: absent on DMs and on rows written before this field
   *  existed — consumers render without the chip then. */
  channelName?: string;
  messageId: string;
  byUserId: string;
  byUserName: string | null;
  preview: string;
};

export type BriefingPayload = {
  periodStart: string;
  periodEnd: string;
  /** The report's Headline section, for the activity card sub. */
  headline: string;
};

export type WorkflowPayload = {
  /** What happened — only run_failed today; future kinds render generically. */
  kind: "run_failed";
  workflowId: string;
  workflowName: string;
  runId: string;
  /** The run-level error message, if one was recorded. */
  error: string | null;
};

export type ProjectAtRiskPayload = {
  projectId: string;
  name: string;
  /** The deterministic pace reasons behind the flip. */
  reasons: string[];
};

export type TaskSlipPayload = {
  taskId: string;
  title: string;
  /** Runway left vs the typical (p75) completion time, both in days. */
  dueInDays: number;
  p75Days: number;
};

export type InsightAlertPayload = {
  /** scopeKey wire format of the rule's lens. */
  scope: string;
  scopeLabel: string;
  metric: string;
  value: number;
  threshold: number | null;
};

export type GuestEscalationPayload = {
  chatbotId: string;
  chatbotName: string;
  conversationId: string;
  guestName: string | null;
  roomNumber: string | null;
  /** The bot's 2-3 sentence summary for staff. */
  summary: string;
  reason: string;
};

export type MeetingSummaryPayload = {
  meetingId: string;
  title: string;
  /** Stream channel id where the summary was posted, or null if the meeting
   *  wasn't tied to a channel. */
  channelId: string | null;
  /** First ~200 chars of the markdown summary, for the activity card sub. */
  preview: string;
};
