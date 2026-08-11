import {
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
 * The Activity section is an inbox: the secondary sidebar is the FILTER NAV
 * (these views), and the main pane is the single feed for whichever view is
 * active (read from `?view=`). One source of truth for both surfaces so they
 * never drift into the "two different lists" confusion they had before.
 */
export type ActivityViewId =
  | "inbox"
  | "unread"
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

/** Top-level views — the inbox and the unread cut. */
export const PRIMARY_VIEWS: ViewDef[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "unread", label: "Unread", icon: CircleDot },
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
  [...PRIMARY_VIEWS, ...FILTER_VIEWS].map((v) => [v.id, v]),
);

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
      return n.type === "briefing" || n.type === "meeting_summary";
    case "invites":
      return n.type === "invite_received";
    default:
      return true;
  }
}
