import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { supabase } from "./supabase";

/**
 * The notifications inbox on the phone — the same rows the web bell and the
 * Activity section show (`notifications`, migration 0004). Read via the web
 * API with the Bearer session (so `getNotifications` stays the one reader),
 * kept live over Supabase Realtime on the user's own rows, and marked read
 * through `/mark-read` (optimistic, like `useNotificationActions` on web).
 */
export type NotificationRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  property_id: string | null;
  seen_at: string | null;
  created_at: string;
};

/** Where a notification row points. Mirrors web's `notificationView` hrefs,
 *  but as native routes; `web` means "only the web app has that page". */
export type NotificationTarget =
  | { kind: "task"; taskId: string }
  | { kind: "channel"; cid: string }
  | { kind: "project"; projectId: string }
  | { kind: "web"; path: string }
  | null;

export type NotificationView = {
  /** Sentence lead, e.g. "Sarah assigned a task to you". */
  lead: string;
  /** Quieter second line (task title, message preview…). */
  sub: string | null;
  /** Ionicons glyph name. */
  icon: string;
  target: NotificationTarget;
};

const s = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Text twin of `apps/web/components/shell/notification-item.tsx:notificationView`. */
export function notificationView(n: NotificationRow): NotificationView {
  const p = n.payload ?? {};
  const by = s(p.byUserName) ?? "Someone";
  const taskTarget: NotificationTarget = s(p.taskId)
    ? { kind: "task", taskId: s(p.taskId)! }
    : null;
  switch (n.type) {
    case "task_assigned":
      return { lead: `${by} assigned a task to you`, sub: s(p.taskTitle) ?? null, icon: "checkmark-circle-outline", target: taskTarget };
    case "task_unassigned":
      return { lead: `${by} unassigned a task from you`, sub: s(p.taskTitle) ?? null, icon: "remove-circle-outline", target: taskTarget };
    case "task_escalated":
      return {
        lead: `${by} escalated a task to you${p.reason === "team_lead" ? " as team lead" : ""}`,
        sub: s(p.note) ?? s(p.taskTitle) ?? null,
        icon: "alert-circle-outline",
        target: taskTarget,
      };
    case "task_comment_mention":
      return {
        lead: `${by} mentioned you in a comment${s(p.taskTitle) ? ` on ${s(p.taskTitle)}` : ""}`,
        sub: s(p.preview) ?? null,
        icon: "chatbox-ellipses-outline",
        target: taskTarget,
      };
    case "mention": {
      const type = s(p.channelType) ?? "team";
      const id = s(p.channelId);
      return {
        lead: `${by} mentioned you${s(p.channelName) ? ` in #${s(p.channelName)}` : type === "messaging" ? " in a DM" : ""}`,
        sub: s(p.preview) ?? null,
        icon: "at-outline",
        target: id ? { kind: "channel", cid: `${type}:${id}` } : null,
      };
    }
    case "channel_added": {
      const id = s(p.channelId);
      return {
        lead: `${by} added you to #${s(p.channelName) ?? "a channel"}`,
        sub: null,
        icon: "chatbubbles-outline",
        target: id ? { kind: "channel", cid: `team:${id}` } : null,
      };
    }
    case "invite_received":
      return {
        lead: `You're invited to ${s(p.propertyName) ?? "a workspace"} as ${s(p.role) ?? "member"}`,
        sub: "Accept on the web app.",
        icon: "mail-outline",
        target: s(p.inviteToken) ? { kind: "web", path: `/invites/${s(p.inviteToken)}` } : null,
      };
    case "invite_access_requested":
      return {
        lead: `${s(p.requesterName) ?? s(p.requesterEmail) ?? "Someone"} can't accept your invite`,
        sub: s(p.requesterEmail) ? `They use ${s(p.requesterEmail)}. Re-send the invite to that address.` : null,
        icon: "mail-unread-outline",
        target: null,
      };
    case "meeting_summary":
      return {
        lead: `Notes ready for ${s(p.title) ?? "a meeting"}`,
        sub: s(p.preview) ?? null,
        icon: "videocam-outline",
        target: s(p.meetingId) ? { kind: "web", path: `/meetings/${s(p.meetingId)}` } : null,
      };
    case "workflow":
      return {
        lead: `${s(p.workflowName) ?? "A workflow"} failed on its last run`,
        sub: s(p.error) ?? null,
        icon: "flash-outline",
        target: s(p.workflowId) ? { kind: "web", path: `/workflows/${s(p.workflowId)}` } : null,
      };
    case "briefing":
      return { lead: "This week's insights report is ready", sub: s(p.headline) ?? null, icon: "stats-chart-outline", target: { kind: "web", path: "/home/insights/reports" } };
    case "ai_message":
      return { lead: `${by} sent a note via the AI`, sub: s(p.message) ?? null, icon: "sparkles-outline", target: null };
    case "insight_alert": {
      const metric = (s(p.metric) ?? "metric").replace(/_/g, " ");
      return {
        lead: `Your alert fired: ${metric}${p.threshold != null ? ` > ${String(p.threshold)}` : ""} in ${s(p.scopeLabel) ?? "your lens"}`,
        sub: p.value !== undefined ? `now at ${String(p.value)}` : null,
        icon: "stats-chart-outline",
        target: { kind: "web", path: "/home/insights" },
      };
    }
    case "project_at_risk":
      return {
        lead: `${s(p.projectName) ?? "A project"} is at risk`,
        sub: s(p.reason) ?? s(p.summary) ?? null,
        icon: "warning-outline",
        target: s(p.projectId) ? { kind: "project", projectId: s(p.projectId)! } : null,
      };
    case "task_slip":
      return {
        lead: `${s(p.taskTitle) ?? "A task"} is likely to slip`,
        sub: s(p.reason) ?? null,
        icon: "time-outline",
        target: taskTarget,
      };
    case "guest_escalation":
      return {
        lead: `A guest needs a person${s(p.botName) ? ` (${s(p.botName)})` : ""}`,
        sub: s(p.preview) ?? s(p.reason) ?? null,
        icon: "person-circle-outline",
        target: s(p.conversationId) ? { kind: "web", path: `/chatbots` } : null,
      };
    default:
      return {
        lead: (n.type || "Notification").replace(/_/g, " "),
        sub: s(p.preview) ?? s(p.message) ?? null,
        icon: "notifications-outline",
        target: null,
      };
  }
}

export function useNotifications(userId: string | undefined) {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await apiFetch<NotificationRow[]>("/api/me/notifications?limit=100");
      setRows(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId]);

  useEffect(() => {
    // Kick the fetch off a microtask so the effect body itself sets no state
    // (react-hooks/set-state-in-effect); the subscription below reloads.
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, userId]);

  const unseenCount = useMemo(() => (rows ?? []).filter((r) => !r.seen_at).length, [rows]);

  const markRead = useCallback(
    (ids: string[] | "all") => {
      const now = new Date().toISOString();
      setRows((prev) =>
        (prev ?? []).map((r) =>
          !r.seen_at && (ids === "all" || ids.includes(r.id)) ? { ...r, seen_at: now } : r,
        ),
      );
      void apiFetch("/api/me/notifications/mark-read", {
        method: "POST",
        body: ids === "all" ? { all: true } : { ids },
      }).catch(() => void load());
    },
    [load],
  );

  return { rows, error, unseenCount, reload: load, markRead };
}
