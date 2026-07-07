"use client";

import { cn } from "@/lib/utils";
import {
  ChartNoAxesColumn,
  Hash,
  Hourglass,
  ListChecks,
  Mail,
  MessageSquareText,
  OctagonAlert,
  UserMinus,
  Video,
  Workflow,
} from "lucide-react";
import type {
  ChannelAddedPayload,
  GuestEscalationPayload,
  InsightAlertPayload,
  InviteReceivedPayload,
  MeetingSummaryPayload,
  MentionPayload,
  NotificationRow,
  ProjectAtRiskPayload,
  TaskAssignedPayload,
  TaskSlipPayload,
  WorkflowPayload,
} from "@/lib/notifications/types";
import { channelHref } from "@/lib/chat/channel-href";

type Props = {
  notification: NotificationRow;
  propertyId: string;
  /** Called with a destination href to navigate to; null = no nav. */
  onSelect: (href: string | null) => void;
  /** Highlight as the currently selected row (Activity master-detail). */
  active?: boolean;
};

/**
 * A single notification row in the Activity feed, replicating Slack's
 * Activity item anatomy: actor avatar (initials — payloads carry names, not
 * avatar URLs) → small type icon → kicker ("Channel mention in") → bordered
 * channel chip (#general) → timestamp, with a single-line truncated content
 * preview below. Rows render inside a per-date bordered card with hairline
 * dividers (see `ActivitySection`); the selected row gets Slack's accent
 * inset border. Actor-less types (briefings, invites, meeting notes) show
 * the type icon in the avatar slot instead. Each `type` value has its own
 * renderer below — when adding a new type server-side, plug it in here too.
 */
export function NotificationItem({
  notification,
  propertyId,
  onSelect,
  active = false,
}: Props) {
  const view = notificationView(notification, propertyId);
  const unseen = !notification.seen_at;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(view.href)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative flex w-full items-start gap-2.5 p-3 text-left transition-colors",
          active ? "bg-primary/5" : "hover:bg-muted/50",
        )}
      >
        {active ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 inset-ring-2 inset-ring-primary/50"
          />
        ) : null}
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold select-none",
            view.actor
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground [&_svg]:size-4",
          )}
          aria-hidden="true"
        >
          {view.actor ? initials(view.actor) : view.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {view.actor ? (
              <span
                className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-3.5"
                aria-hidden="true"
              >
                {view.icon}
              </span>
            ) : null}
            <p
              className={cn(
                "min-w-0 truncate text-sm leading-5 font-medium",
                unseen ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {view.kicker}
            </p>
            {view.channel ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-sm border border-border bg-muted/50 px-1.5 py-px text-xs font-medium",
                  unseen ? "text-foreground/80" : "text-muted-foreground",
                )}
              >
                {view.channel}
              </span>
            ) : null}
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground/80 tabular-nums">
              {relativeTime(notification.created_at)}
              {unseen ? (
                <span
                  className="size-1.5 rounded-full bg-primary"
                  aria-label="Unread"
                />
              ) : null}
            </span>
          </div>
          {view.preview ? (
            <p
              className={cn(
                "mt-0.5 truncate text-sm",
                unseen ? "text-foreground/70" : "text-muted-foreground",
              )}
            >
              {view.preview}
            </p>
          ) : null}
        </div>
      </button>
    </li>
  );
}

/** "Marco Rossi" → "MR" for the Slack-style actor avatar. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export type NotificationView = {
  icon: React.ReactNode;
  lead: React.ReactNode;
  sub: React.ReactNode | null;
  href: string | null;
  /** Slack-style context line for the sidebar feed — what kind of thing
   *  happened ("Channel mention in", "Task assigned"). */
  kicker: string;
  /** Slack-style content line — the substance only ("can you check the
   *  freezer?"); the actor is carried by the avatar. Null when the kicker
   *  says it all. */
  preview: string | null;
  /** Who did it — drawn as an initials avatar, Slack-style. Null for
   *  actor-less notifications (briefings, invites), which show the type
   *  icon in the avatar slot instead. */
  actor: string | null;
  /** Channel context rendered as a bordered chip after the kicker, like
   *  Slack's `#general` chip. Null when there's no channel to point at. */
  channel: string | null;
};

/** Maps a notification row to its icon / lead / sub / destination. Exported so
 *  other surfaces (e.g. the Home Activity widget) render the same content in a
 *  different shell. */
export function notificationView(
  n: NotificationRow,
  propertyId: string,
): NotificationView {
  switch (n.type) {
    case "task_assigned": {
      const p = n.payload as Partial<TaskAssignedPayload>;
      const byName = p.byUserName ?? "Someone";
      return {
        icon: <ListChecks className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">{byName}</strong> assigned a
            task to you
          </>
        ),
        sub: p.taskTitle ?? null,
        href: p.taskId ? `/p/${propertyId}/tasks/${p.taskId}` : null,
        kicker: "Task assigned",
        preview: p.taskTitle ?? "a task",
        actor: byName,
        channel: null,
      };
    }
    case "task_unassigned": {
      const p = n.payload as Partial<TaskAssignedPayload>;
      const byName = p.byUserName ?? "Someone";
      return {
        icon: <UserMinus className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">{byName}</strong>{" "}
            unassigned a task from you
          </>
        ),
        sub: p.taskTitle ?? null,
        href: p.taskId ? `/p/${propertyId}/tasks/${p.taskId}` : null,
        kicker: "Task unassigned",
        preview: p.taskTitle ?? "a task",
        actor: byName,
        channel: null,
      };
    }
    case "channel_added": {
      const p = n.payload as Partial<ChannelAddedPayload>;
      const byName = p.byUserName ?? "Someone";
      return {
        icon: <Hash className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">{byName}</strong>{" "}
            added you to{" "}
            <span className="font-medium">#{p.channelName ?? "a channel"}</span>
          </>
        ),
        sub: null,
        href: p.channelId
          ? channelHref(propertyId, "team", p.channelId)
          : null,
        kicker: "Added you to",
        preview: null,
        actor: byName,
        channel: `#${p.channelName ?? "channel"}`,
      };
    }
    case "invite_received": {
      const p = n.payload as Partial<InviteReceivedPayload>;
      return {
        icon: <Mail className="size-3.5" />,
        lead: (
          <>
            You&apos;re invited to{" "}
            <strong className="font-semibold">
              {p.propertyName ?? "a workspace"}
            </strong>{" "}
            as <span className="capitalize">{p.role ?? "member"}</span>
          </>
        ),
        sub: null,
        href: p.inviteToken ? `/invites/${p.inviteToken}` : null,
        kicker: "Workspace invite",
        preview: `Join ${p.propertyName ?? "a workspace"} as ${p.role ?? "member"}`,
        actor: null,
        channel: null,
      };
    }
    case "mention": {
      const p = n.payload as Partial<MentionPayload>;
      const byName = p.byUserName ?? "Someone";
      return {
        icon: <MessageSquareText className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">{byName}</strong> mentioned you
          </>
        ),
        sub: p.preview ?? null,
        href: p.channelId
          ? channelHref(propertyId, p.channelType, p.channelId)
          : null,
        kicker:
          p.channelType === "messaging"
            ? "Mention in a DM"
            : p.channelName
              ? "Mention in"
              : "Mention",
        preview: p.preview ?? "mentioned you",
        actor: byName,
        channel: p.channelName ? `#${p.channelName}` : null,
      };
    }
    case "meeting_summary": {
      const p = n.payload as Partial<MeetingSummaryPayload>;
      return {
        icon: <Video className="size-3.5" />,
        lead: (
          <>
            Notes ready for{" "}
            <strong className="font-semibold">
              {p.title ?? "a meeting"}
            </strong>
          </>
        ),
        sub: p.preview ?? null,
        href: p.meetingId
          ? `/p/${propertyId}/meetings/${p.meetingId}`
          : null,
        kicker: "Meeting notes",
        preview: p.title
          ? `${p.title}${p.preview ? ` — ${p.preview}` : ""}`
          : (p.preview ?? null),
        actor: null,
        channel: null,
      };
    }
    case "workflow": {
      const p = n.payload as Partial<WorkflowPayload>;
      const name = p.workflowName ?? "A workflow";
      return {
        icon: <Workflow className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">{name}</strong> failed on its
            last run
          </>
        ),
        sub: p.error ?? null,
        href:
          p.workflowId && p.runId
            ? `/p/${propertyId}/workflows/${p.workflowId}/runs/${p.runId}`
            : p.workflowId
              ? `/p/${propertyId}/workflows/${p.workflowId}`
              : `/p/${propertyId}/workflows`,
        kicker: "Workflow failed",
        preview: p.error ?? `${name} needs attention`,
        actor: null,
        channel: null,
      };
    }
    case "briefing": {
      const p = n.payload as Partial<{
        periodStart: string;
        periodEnd: string;
        headline: string;
      }>;
      return {
        icon: <ChartNoAxesColumn className="size-3.5" />,
        lead: (
          <>
            This week&apos;s{" "}
            <strong className="font-semibold">insights report</strong> is ready
          </>
        ),
        sub: p.headline ?? null,
        href: `/p/${propertyId}/home/insights/reports`,
        kicker: "Weekly insights",
        preview: p.headline ?? "This week's report is ready",
        actor: null,
        channel: null,
      };
    }
    case "insight_alert": {
      const p = n.payload as Partial<InsightAlertPayload>;
      const metricLabel = (p.metric ?? "metric").replaceAll("_", " ");
      return {
        icon: <ChartNoAxesColumn className="size-3.5" />,
        lead: (
          <>
            Your alert fired:{" "}
            <strong className="font-semibold">
              {metricLabel}
              {p.threshold !== null && p.threshold !== undefined
                ? ` > ${p.threshold}`
                : ""}
            </strong>{" "}
            in {p.scopeLabel ?? "your lens"}
          </>
        ),
        sub: p.value !== undefined ? `now at ${p.value}` : null,
        href: `/p/${propertyId}/home/insights`,
        kicker: "Insight alert",
        preview: `${metricLabel} now at ${p.value ?? "?"} — ${p.scopeLabel ?? ""}`,
        actor: null,
        channel: null,
      };
    }
    case "project_at_risk": {
      const p = n.payload as Partial<ProjectAtRiskPayload>;
      const name = p.name ?? "A project";
      return {
        icon: <OctagonAlert className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">{name}</strong> flipped to at
            risk
          </>
        ),
        sub: p.reasons?.join("; ") ?? null,
        href: p.projectId
          ? `/p/${propertyId}/projects/${p.projectId}`
          : `/p/${propertyId}/home/insights`,
        kicker: "Project at risk",
        preview: p.reasons?.[0] ?? `${name} needs attention`,
        actor: null,
        channel: null,
      };
    }
    case "task_slip": {
      const p = n.payload as Partial<TaskSlipPayload>;
      const title = p.title ?? "A task";
      return {
        icon: <Hourglass className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">{title}</strong> will likely slip
          </>
        ),
        sub:
          p.dueInDays !== undefined && p.p75Days !== undefined
            ? `due in ${p.dueInDays}d — similar work typically takes ${p.p75Days}d`
            : null,
        href: p.taskId
          ? `/p/${propertyId}/tasks/${p.taskId}`
          : `/p/${propertyId}/tasks`,
        kicker: "Deadline risk",
        preview:
          p.dueInDays !== undefined
            ? `${title} due in ${p.dueInDays}d`
            : `${title} is at deadline risk`,
        actor: null,
        channel: null,
      };
    }
    case "guest_escalation": {
      const p = n.payload as Partial<GuestEscalationPayload>;
      const guest = p.guestName ?? "A guest";
      return {
        icon: <MessageSquareText className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">{guest}</strong>
            {p.roomNumber ? ` (room ${p.roomNumber})` : ""} needs a human —{" "}
            {p.chatbotName ?? "chatbot"}
          </>
        ),
        sub: p.summary ?? null,
        href:
          p.chatbotId && p.conversationId
            ? `/p/${propertyId}/chatbots/${p.chatbotId}/conversations/${p.conversationId}`
            : `/p/${propertyId}/chatbots`,
        kicker: "Guest escalation",
        preview: p.summary ?? `${guest} asked for a person`,
        actor: null,
        channel: null,
      };
    }
    default:
      return {
        icon: <Bell className="size-3.5" />,
        lead: <>New notification</>,
        sub: null,
        href: null,
        kicker: "Notification",
        preview: null,
        actor: null,
        channel: null,
      };
  }
}

function Bell(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** Compact relative time ("now", "5m", "22h", "3d") — the date group headers
 *  already carry the full date, so the per-row stamp stays terse. */
function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
