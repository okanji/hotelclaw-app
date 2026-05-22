"use client";

import { cn } from "@/lib/utils";
import {
  Hash,
  ListChecks,
  Mail,
  MessageSquareText,
  UserMinus,
  Video,
} from "lucide-react";
import type {
  ChannelAddedPayload,
  InviteReceivedPayload,
  MeetingSummaryPayload,
  MentionPayload,
  NotificationRow,
  TaskAssignedPayload,
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
 * A single notification card in the Activity feed: icon avatar + lead + time
 * on one row, with an optional preview line below. Each `type` value has its
 * own renderer below — when adding a new type server-side, plug it in here too.
 */
export function NotificationItem({
  notification,
  propertyId,
  onSelect,
  active = false,
}: Props) {
  const view = renderView(notification, propertyId);
  const unseen = !notification.seen_at;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(view.href)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left",
          active
            ? "border-primary/40 ring-2 ring-primary/30"
            : "border-border hover:border-foreground/25",
          unseen && !active && "bg-primary/5",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            unseen
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {view.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm leading-snug">{view.lead}</p>
            <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
              {unseen ? (
                <span
                  className="size-2 rounded-full bg-primary"
                  aria-label="Unread"
                />
              ) : null}
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {relativeTime(notification.created_at)}
              </span>
            </span>
          </div>
          {view.sub ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {view.sub}
            </p>
          ) : null}
        </div>
      </button>
    </li>
  );
}

type View = {
  icon: React.ReactNode;
  lead: React.ReactNode;
  sub: React.ReactNode | null;
  href: string | null;
};

function renderView(n: NotificationRow, propertyId: string): View {
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
      };
    }
    case "task_unassigned": {
      const p = n.payload as Partial<TaskAssignedPayload>;
      return {
        icon: <UserMinus className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">
              {p.byUserName ?? "Someone"}
            </strong>{" "}
            unassigned a task from you
          </>
        ),
        sub: p.taskTitle ?? null,
        href: p.taskId ? `/p/${propertyId}/tasks/${p.taskId}` : null,
      };
    }
    case "channel_added": {
      const p = n.payload as Partial<ChannelAddedPayload>;
      return {
        icon: <Hash className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">
              {p.byUserName ?? "Someone"}
            </strong>{" "}
            added you to{" "}
            <span className="font-medium">#{p.channelName ?? "a channel"}</span>
          </>
        ),
        sub: null,
        href: p.channelId
          ? channelHref(propertyId, "team", p.channelId)
          : null,
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
      };
    }
    case "mention": {
      const p = n.payload as Partial<MentionPayload>;
      return {
        icon: <MessageSquareText className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">
              {p.byUserName ?? "Someone"}
            </strong>{" "}
            mentioned you
          </>
        ),
        sub: p.preview ?? null,
        href: p.channelId
          ? channelHref(propertyId, p.channelType, p.channelId)
          : null,
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
      };
    }
    default:
      return {
        icon: <Bell className="size-3.5" />,
        lead: <>New notification</>,
        sub: null,
        href: null,
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

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
