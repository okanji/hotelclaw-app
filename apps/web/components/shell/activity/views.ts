import {
  Activity,
  AtSign,
  ChartNoAxesColumn,
  CircleDot,
  Hash,
  Inbox,
  ListChecks,
  Mail,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";
import type { NotificationRow } from "@/lib/notifications/types";

/**
 * The Activity section is an inbox: the page header's tab strip is the FILTER
 * NAV (these views), and the feed below is the single list for whichever view
 * is active (read from `?view=`). The sidebar's Inbox node keeps a few of the
 * same views as shortcuts. One source of truth for every surface so they
 * never drift into the "two different lists" confusion they had before.
 */
export type ActivityViewId =
  | "inbox"
  | "unread"
  | "workspace"
  | "mentions"
  | "tasks"
  | "channels"
  | "alerts"
  | "reports"
  | "invites";

type ViewDef = {
  id: ActivityViewId;
  label: string;
  icon: LucideIcon;
  /** Amber-accented operational view (escalations, risks, failures). */
  attention?: boolean;
};

/** Top-level views — the inbox and the unread cut. The inbox row reads
 *  "All" because the You block above every sidebar already says "Inbox". */
export const PRIMARY_VIEWS: ViewDef[] = [
  { id: "inbox", label: "All", icon: Inbox },
  { id: "unread", label: "Unread", icon: CircleDot },
];

/**
 * Not a notification slice: the property-wide "who did what" feed read from
 * `activity_log` (migration 0106). The inbox answers "what needs me"; this
 * answers "what changed", for everyone, with the actor on every row — so it
 * gets its own sidebar group instead of sitting among the inbox cuts.
 */
export const WORKSPACE_VIEWS: ViewDef[] = [
  { id: "workspace", label: "All activity", icon: Activity },
];

/** Type filters — the "folders" of the inbox. */
export const FILTER_VIEWS: ViewDef[] = [
  { id: "mentions", label: "Mentions", icon: AtSign },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "channels", label: "Channels", icon: Hash },
  { id: "alerts", label: "Alerts", icon: OctagonAlert, attention: true },
  { id: "reports", label: "Reports", icon: ChartNoAxesColumn },
  { id: "invites", label: "Invites", icon: Mail },
];

const VIEW_BY_ID = new Map<ActivityViewId, ViewDef>(
  [...PRIMARY_VIEWS, ...FILTER_VIEWS, ...WORKSPACE_VIEWS].map((v) => [v.id, v]),
);

/** Every notification view (everything but the activity_log feed). */
export const NOTIFICATION_VIEWS: ViewDef[] = [...PRIMARY_VIEWS, ...FILTER_VIEWS];

/** Unread count per notification view — the badge on each tab / shortcut. */
export function unreadCountsByView(
  notifications: NotificationRow[],
): Record<ActivityViewId, number> {
  const counts = {} as Record<ActivityViewId, number>;
  for (const v of [...NOTIFICATION_VIEWS, ...WORKSPACE_VIEWS]) counts[v.id] = 0;
  for (const n of notifications) {
    if (n.seen_at) continue;
    for (const v of NOTIFICATION_VIEWS) {
      if (matchesView(n, v.id)) counts[v.id] += 1;
    }
  }
  return counts;
}

/**
 * The task a notification is about, when it's about exactly one — drives the
 * inbox's split pane (the task opens beside the list instead of navigating).
 */
export function notificationTaskId(n: NotificationRow): string | null {
  const id = n.payload?.taskId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function viewDef(id: ActivityViewId): ViewDef {
  return VIEW_BY_ID.get(id) ?? PRIMARY_VIEWS[0];
}

/** Coerce a raw `?view=` param into a known view, defaulting to the inbox. */
export function viewFromParam(raw: string | null): ActivityViewId {
  return raw && VIEW_BY_ID.has(raw as ActivityViewId)
    ? (raw as ActivityViewId)
    : "inbox";
}

/** Which notification types fall under each filter view. */
export function matchesView(n: NotificationRow, view: ActivityViewId): boolean {
  switch (view) {
    case "inbox":
      return true;
    case "unread":
      return !n.seen_at;
    case "workspace":
      // Rendered from activity_log, not notifications — never counts unread.
      return false;
    case "mentions":
      return n.type === "mention" || n.type === "task_comment_mention";
    case "tasks":
      return (
        n.type === "task_assigned" ||
        n.type === "task_unassigned" ||
        n.type === "task_escalated"
      );
    case "channels":
      return n.type === "channel_added";
    case "alerts":
      return (
        n.type === "guest_escalation" ||
        n.type === "project_at_risk" ||
        n.type === "task_slip" ||
        n.type === "insight_alert" ||
        n.type === "workflow"
      );
    case "reports":
      return (
        n.type === "briefing" ||
        n.type === "meeting_summary" ||
        n.type === "project_update"
      );
    case "invites":
      return n.type === "invite_received";
    default:
      return true;
  }
}
