"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Hash,
  ListChecks,
  Mail,
  MessageSquareText,
  UserMinus,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/components/shell/use-notifications";
import { channelHref } from "@/lib/chat/channel-href";
import { relativeShort } from "@/components/home/editorial-section";
import type {
  ChannelAddedPayload,
  InviteReceivedPayload,
  MeetingSummaryPayload,
  MentionPayload,
  NotificationRow,
  TaskAssignedPayload,
} from "@/lib/notifications/types";

/**
 * Focused activity feed — the default main-pane view when no notification is
 * selected in the sidebar. Deliberately NOT a dashboard: the calendar / tasks /
 * documents summaries live on Home. This surface is only the feed — one
 * readable column of everything that's happened, filterable by kind and laid
 * out on a day-grouped timeline rail. Selecting a row in the sidebar swaps this
 * for the notification's target (`ActivityDetail`).
 */
export function ActivityHub({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const { notifications } = useNotifications(userId);
  const [filter, setFilter] = useState<TimelineFilter>("all");

  const filtered = useMemo(
    () => notifications.filter((n) => matchesFilter(n, filter)).slice(0, 40),
    [notifications, filter],
  );
  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-7 sm:px-8 sm:py-9">
      {/* Filter toolbar — sticks under the page header while the feed scrolls. */}
      <div className="sticky top-0 z-10 bg-card pb-4">
        <FilterTabs value={filter} onChange={setFilter} />
      </div>

      {filtered.length === 0 ? (
        <EmptyFeed filter={filter} />
      ) : (
        <div className="flex flex-col gap-9">
          {grouped.map((group) => (
            <section key={group.key} className="flex flex-col gap-4">
              <h2 className="text-[0.625rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
                {group.label}
              </h2>
              <ol
                role="list"
                className="relative ml-[3px] flex flex-col border-l border-border pl-6"
              >
                {group.items.map((n) => (
                  <TimelineItem
                    key={n.id}
                    notification={n}
                    propertyId={propertyId}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Filter tabs                                                                */
/* -------------------------------------------------------------------------- */

type TimelineFilter = "all" | "mentions" | "tasks" | "channels" | "meetings";

function FilterTabs({
  value,
  onChange,
}: {
  value: TimelineFilter;
  onChange: (next: TimelineFilter) => void;
}) {
  const tabs: { id: TimelineFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "mentions", label: "Mentions" },
    { id: "tasks", label: "Tasks" },
    { id: "channels", label: "Channels" },
    { id: "meetings", label: "Meetings" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Activity filter"
      className="flex items-center gap-1 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[0.8125rem] font-medium tracking-tight transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Timeline item                                                              */
/* -------------------------------------------------------------------------- */

function TimelineItem({
  notification,
  propertyId,
}: {
  notification: NotificationRow;
  propertyId: string;
}) {
  const view = renderTimelineView(notification, propertyId);
  const unseen = !notification.seen_at;
  return (
    <li className="relative pb-6 last:pb-0">
      <span
        aria-hidden="true"
        className={cn(
          "absolute -left-6 top-0.5 flex size-5 -translate-x-1/2 items-center justify-center rounded-full bg-card",
          unseen ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {view.icon}
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cn(
              "min-w-0 text-[0.875rem] leading-5 tracking-tight text-foreground",
              unseen && "font-medium",
            )}
          >
            {view.lead}
          </p>
          <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[0.75rem] tabular-nums text-muted-foreground">
            {unseen ? (
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-foreground"
              />
            ) : null}
            {relativeShort(notification.created_at)}
          </span>
        </div>
        {view.sub ? (
          <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-5 text-muted-foreground">
            {view.sub}
          </p>
        ) : null}
        {view.href ? (
          <Link
            href={view.href}
            className="mt-1.5 inline-flex items-center gap-1 text-[0.75rem] font-medium tracking-tight text-muted-foreground transition-colors hover:text-foreground"
          >
            {view.cta ?? "Open"}
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyFeed({ filter }: { filter: TimelineFilter }) {
  const message =
    filter === "all"
      ? "You're all caught up — new activity will show up here."
      : `No ${filter} to show.`;
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bell className="size-5" />
      </span>
      <p className="max-w-[36ch] text-sm text-pretty text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function matchesFilter(n: NotificationRow, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "mentions") return n.type === "mention";
  if (filter === "tasks")
    return n.type === "task_assigned" || n.type === "task_unassigned";
  if (filter === "channels") return n.type === "channel_added";
  if (filter === "meetings") return n.type === "meeting_summary";
  return true;
}

type DayGroup = { key: string; label: string; items: NotificationRow[] };

function groupByDay(items: NotificationRow[]): DayGroup[] {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const out: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const n of items) {
    const d = new Date(n.created_at);
    const key = d.toDateString();
    if (!current || current.key !== key) {
      let label: string;
      if (key === today.toDateString()) label = "Today";
      else if (key === yesterday.toDateString()) label = "Yesterday";
      else
        label = d.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
      current = { key, label, items: [] };
      out.push(current);
    }
    current.items.push(n);
  }
  return out;
}

type TimelineView = {
  icon: React.ReactNode;
  lead: React.ReactNode;
  sub: React.ReactNode | null;
  href: string | null;
  cta?: string;
};

function renderTimelineView(
  n: NotificationRow,
  propertyId: string,
): TimelineView {
  switch (n.type) {
    case "task_assigned": {
      const p = n.payload as Partial<TaskAssignedPayload>;
      return {
        icon: <ListChecks className="size-3.5" />,
        lead: (
          <>
            <strong className="font-semibold">
              {p.byUserName ?? "Someone"}
            </strong>{" "}
            assigned you a task
          </>
        ),
        sub: p.taskTitle ?? null,
        href: p.taskId ? `/p/${propertyId}/tasks/${p.taskId}` : null,
        cta: "Open task",
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
            unassigned you from a task
          </>
        ),
        sub: p.taskTitle ?? null,
        href: p.taskId ? `/p/${propertyId}/tasks/${p.taskId}` : null,
        cta: "Open task",
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
        cta: "Go to channel",
      };
    }
    case "invite_received": {
      const p = n.payload as Partial<InviteReceivedPayload>;
      return {
        icon: <Mail className="size-3.5" />,
        lead: (
          <>
            Invitation to{" "}
            <strong className="font-semibold">
              {p.propertyName ?? "a workspace"}
            </strong>{" "}
            as <span className="capitalize">{p.role ?? "member"}</span>
          </>
        ),
        sub: null,
        href: p.inviteToken ? `/invites/${p.inviteToken}` : null,
        cta: "View invitation",
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
        cta: "Open message",
      };
    }
    case "meeting_summary": {
      const p = n.payload as Partial<MeetingSummaryPayload>;
      return {
        icon: <Video className="size-3.5" />,
        lead: (
          <>
            Notes ready for{" "}
            <strong className="font-semibold">{p.title ?? "a meeting"}</strong>
          </>
        ),
        sub: p.preview ?? null,
        href: p.meetingId ? `/p/${propertyId}/meetings/${p.meetingId}` : null,
        cta: "Read summary",
      };
    }
    default:
      return {
        icon: <Bell className="size-3.5" />,
        lead: <>New activity</>,
        sub: null,
        href: null,
      };
  }
}
