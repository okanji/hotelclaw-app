"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Hash,
  ListChecks,
  Mail,
  MessageSquareText,
  Sun,
  Sunrise,
  Sunset,
  UserMinus,
  Video,
  FileText,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  documentsQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { calendarEventsQueryOptions } from "@/lib/calendar/query-options";
import { useNotifications } from "@/components/shell/use-notifications";
import { channelHref } from "@/lib/chat/channel-href";
import { StatusIcon } from "@/components/tasks/task-icons";
import {
  DividerList,
  ROW_CLASS,
  Stats,
  WidgetEmpty,
  relativeShort,
} from "@/components/home/editorial-section";
import type {
  CalendarEvent,
  MeetingEvent,
  TaskEvent,
} from "@/lib/calendar/types";
import type { Task } from "@/components/tasks/kanban";
import type {
  ChannelAddedPayload,
  InviteReceivedPayload,
  MeetingSummaryPayload,
  MentionPayload,
  NotificationRow,
  TaskAssignedPayload,
} from "@/lib/notifications/types";

/**
 * Personal activity hub — the default view of the main pane when no
 * notification is selected in the sidebar. Rendered in the same editorial
 * language as Home (`components/home`): an oversized greeting, an inline
 * stat row, then stacked kicker + heading + hairline sections laid out with
 * whitespace and dividers rather than cards. Pulls from the warmed caches the
 * rail already prefetches (notifications, tasks, calendar, documents).
 */
export function ActivityHub({
  propertyId,
  userId,
  userName,
}: {
  propertyId: string;
  userId: string;
  userName: string | null;
}) {
  const { notifications } = useNotifications(userId);
  const tasksQuery = useQuery(tasksQueryOptions(propertyId));
  const docsQuery = useQuery(documentsQueryOptions(propertyId));
  const calendarQuery = useQuery(
    calendarEventsQueryOptions(propertyId, todayRange()),
  );

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const docs = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);
  const events = useMemo(() => calendarQuery.data ?? [], [calendarQuery.data]);

  const myTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.assignee_id === userId && t.status !== "done")
        .sort(taskSortByUrgency)
        .slice(0, 6),
    [tasks, userId],
  );

  const upNext = useMemo(
    () => buildUpNext({ events, tasks, userId, propertyId }).slice(0, 4),
    [events, tasks, userId, propertyId],
  );

  const todayCounts = useMemo(
    () => countTodayActivity({ notifications, upNext }),
    [notifications, upNext],
  );

  return (
    <div className="@container/hub mx-auto w-full max-w-6xl px-8 pt-10 pb-16 sm:px-14">
      <GreetingHeader userName={userName} counts={todayCounts} />

      <hr className="my-12 border-border" />

      <div className="flex flex-col gap-16">
        <UpNextSection items={upNext} propertyId={propertyId} />

        <div className="grid grid-cols-1 gap-x-10 gap-y-16 @4xl/hub:grid-cols-5">
          <div className="@4xl/hub:col-span-3">
            <ActivityTimeline
              notifications={notifications}
              propertyId={propertyId}
            />
          </div>
          <div className="flex flex-col gap-16 @4xl/hub:col-span-2">
            <YourTasksSection tasks={myTasks} propertyId={propertyId} />
            <RecentDocsSection docs={docs} propertyId={propertyId} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Greeting + stat row                                                       */
/* -------------------------------------------------------------------------- */

function GreetingHeader({
  userName,
  counts,
}: {
  userName: string | null;
  counts: {
    unread: number;
    mentionsToday: number;
    tasksDueToday: number;
    meetingsToday: number;
  };
}) {
  const hour = new Date().getHours();
  const { greeting } = greetingForHour(hour);
  const firstName = (userName ?? "").split(" ")[0]?.trim() || null;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="flex flex-col gap-5">
      <h1 className="text-[3.25rem] leading-none font-semibold tracking-tight text-foreground sm:text-[4rem]">
        {greeting}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed tracking-tight text-pretty text-muted-foreground">
        {today} · Here&apos;s what&apos;s happening across your workspace.
      </p>
      <div className="pt-3">
        <Stats
          items={[
            { label: "unread", value: counts.unread },
            { label: "mentions today", value: counts.mentionsToday },
            { label: "tasks due today", value: counts.tasksDueToday },
            { label: "meetings today", value: counts.meetingsToday },
          ]}
        />
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/*  Editorial section shell                                                    */
/* -------------------------------------------------------------------------- */

/** Kicker + heading over a hairline rule — the Home "EditorialSection" header,
 *  minus the drag/hide affordances (the activity hub isn't rearrangeable). */
function Section({
  kicker,
  title,
  action,
  children,
}: {
  kicker: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-6 flex items-end justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.625rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
            {kicker}
          </span>
          <h2 className="truncate text-[1.375rem] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        </div>
        {action ? <div className="shrink-0 pb-0.5">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function SectionLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="text-[0.8125rem] font-medium tracking-tight text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Up Next                                                                    */
/* -------------------------------------------------------------------------- */

type UpNextItem =
  | {
      kind: "meeting";
      id: string;
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      location: string | null;
      href: string;
    }
  | {
      kind: "task";
      id: string;
      title: string;
      due: string;
      priority: Task["priority"];
      href: string;
    };

function UpNextSection({
  items,
  propertyId,
}: {
  items: UpNextItem[];
  propertyId: string;
}) {
  return (
    <Section
      kicker="On your calendar"
      title="Up next"
      action={
        <SectionLink href={`/p/${propertyId}/calendar`}>
          Open calendar
        </SectionLink>
      }
    >
      {items.length === 0 ? (
        <WidgetEmpty>Nothing scheduled for the rest of today.</WidgetEmpty>
      ) : (
        <DividerList>
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <Link
                href={item.href}
                className={cn(
                  ROW_CLASS,
                  "rounded-md transition-colors hover:bg-muted",
                )}
              >
                {item.kind === "meeting" ? (
                  <Video className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ListChecks className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                  {item.title}
                </span>
                <span className="shrink-0 text-[0.75rem] tracking-tight tabular-nums text-muted-foreground">
                  {item.kind === "meeting" && item.allDay
                    ? "All day"
                    : timeLabel(item.kind === "meeting" ? item.start : item.due)}
                </span>
              </Link>
            </li>
          ))}
        </DividerList>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Activity timeline                                                          */
/* -------------------------------------------------------------------------- */

type TimelineFilter = "all" | "mentions" | "tasks" | "channels" | "meetings";

function ActivityTimeline({
  notifications,
  propertyId,
}: {
  notifications: NotificationRow[];
  propertyId: string;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");

  const filtered = useMemo(
    () => notifications.filter((n) => matchesFilter(n, filter)).slice(0, 20),
    [notifications, filter],
  );

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <Section kicker="What's new" title="Recent activity">
      <div className="flex flex-col gap-6">
        <FilterTabs value={filter} onChange={setFilter} />
        {filtered.length === 0 ? (
          <WidgetEmpty>You&apos;re all caught up.</WidgetEmpty>
        ) : (
          <div className="flex flex-col gap-8">
            {grouped.map((group) => (
              <div key={group.key} className="flex flex-col gap-3">
                <h3 className="text-[0.625rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
                  {group.label}
                </h3>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

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
/*  Your tasks                                                                 */
/* -------------------------------------------------------------------------- */

function YourTasksSection({
  tasks,
  propertyId,
}: {
  tasks: Task[];
  propertyId: string;
}) {
  return (
    <Section
      kicker="Assigned to you"
      title="Your tasks"
      action={
        <SectionLink href={`/p/${propertyId}/tasks`}>Open board</SectionLink>
      }
    >
      {tasks.length === 0 ? (
        <WidgetEmpty>No active tasks assigned to you.</WidgetEmpty>
      ) : (
        <DividerList>
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={`/p/${propertyId}/tasks/${task.id}`}
                className={cn(
                  ROW_CLASS,
                  "rounded-md transition-colors hover:bg-muted",
                )}
              >
                <StatusIcon status={task.status} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                  {task.title || "Untitled task"}
                </span>
                {task.due_at ? (
                  <span
                    className={cn(
                      "shrink-0 text-[0.75rem] tracking-tight tabular-nums",
                      isOverdue(task.due_at)
                        ? "text-rose-500"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatDue(task.due_at)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </DividerList>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Recent docs                                                                */
/* -------------------------------------------------------------------------- */

function RecentDocsSection({
  docs,
  propertyId,
}: {
  docs: Array<{ id: string; title: string; updated_at: string }>;
  propertyId: string;
}) {
  const top = docs.slice(0, 5);
  return (
    <Section
      kicker="Recently edited"
      title="Recent documents"
      action={
        <SectionLink href={`/p/${propertyId}/documents`}>Open docs</SectionLink>
      }
    >
      {top.length === 0 ? (
        <WidgetEmpty>No documents yet.</WidgetEmpty>
      ) : (
        <DividerList>
          {top.map((doc) => (
            <li key={doc.id}>
              <Link
                href={`/p/${propertyId}/documents/${doc.id}`}
                className={cn(
                  ROW_CLASS,
                  "rounded-md transition-colors hover:bg-muted",
                )}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                  {doc.title || "Untitled"}
                </span>
                <span className="shrink-0 text-[0.75rem] tracking-tight tabular-nums text-muted-foreground">
                  {relativeShort(doc.updated_at)}
                </span>
              </Link>
            </li>
          ))}
        </DividerList>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function greetingForHour(hour: number): {
  greeting: string;
  Icon: typeof Sun;
} {
  if (hour < 5) return { greeting: "Good evening", Icon: Sunset };
  if (hour < 12) return { greeting: "Good morning", Icon: Sunrise };
  if (hour < 17) return { greeting: "Good afternoon", Icon: Sun };
  return { greeting: "Good evening", Icon: Sunset };
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function todayRange(): { from: string; to: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function countTodayActivity({
  notifications,
  upNext,
}: {
  notifications: NotificationRow[];
  upNext: UpNextItem[];
}) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let unread = 0;
  let mentionsToday = 0;
  for (const n of notifications) {
    if (!n.seen_at) unread += 1;
    if (n.type === "mention" && new Date(n.created_at) >= startOfDay) {
      mentionsToday += 1;
    }
  }

  const meetingsToday = upNext.filter((i) => i.kind === "meeting").length;
  const tasksDueToday = upNext.filter((i) => i.kind === "task").length;

  return { unread, mentionsToday, tasksDueToday, meetingsToday };
}

function buildUpNext({
  events,
  tasks,
  userId,
  propertyId,
}: {
  events: CalendarEvent[];
  tasks: Task[];
  userId: string;
  propertyId: string;
}): UpNextItem[] {
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const endTs = endOfDay.getTime();

  const meetings: UpNextItem[] = events
    .filter((e): e is MeetingEvent | TaskEvent => e.source !== "external")
    .flatMap<UpNextItem>((e) => {
      const startTs = new Date(e.start).getTime();
      const endEventTs = new Date(e.end).getTime();
      if (endEventTs <= now || startTs > endTs) return [];
      if (e.source === "meeting") {
        const involved =
          e.host_id === userId ||
          e.attendees.some((a) => a.user_id === userId);
        if (!involved) return [];
        return [
          {
            kind: "meeting",
            id: e.id,
            title: e.title,
            start: e.start,
            end: e.end,
            allDay: e.all_day,
            location: e.location,
            href: e.channel_id
              ? channelHref(propertyId, "team", e.channel_id)
              : `/p/${propertyId}/calendar`,
          },
        ];
      }
      if (e.source === "task" && e.assignee_id === userId) {
        return [
          {
            kind: "task",
            id: e.id,
            title: e.title,
            due: e.start,
            priority: (e.priority as Task["priority"]) ?? "none",
            href: `/p/${propertyId}/tasks/${e.id}`,
          },
        ];
      }
      return [];
    });

  const dueTasks: UpNextItem[] = tasks
    .filter(
      (t) =>
        t.assignee_id === userId &&
        t.status !== "done" &&
        t.due_at &&
        new Date(t.due_at).getTime() <= endTs &&
        new Date(t.due_at).getTime() >= now - 1000 * 60 * 60 * 12,
    )
    .map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      due: t.due_at as string,
      priority: t.priority,
      href: `/p/${propertyId}/tasks/${t.id}`,
    }));

  // Merge + dedupe by id+kind, sort ascending by time
  const seen = new Set<string>();
  const merged = [...meetings, ...dueTasks].filter((i) => {
    const k = `${i.kind}:${i.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return merged.sort((a, b) => {
    const aTs = new Date(a.kind === "meeting" ? a.start : a.due).getTime();
    const bTs = new Date(b.kind === "meeting" ? b.start : b.due).getTime();
    return aTs - bTs;
  });
}

const PRIORITY_RANK: Record<Task["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

function taskSortByUrgency(a: Task, b: Task) {
  // Tasks with due dates first, sorted by due ascending; then by priority.
  const aDue = a.due_at ? new Date(a.due_at).getTime() : null;
  const bDue = b.due_at ? new Date(b.due_at).getTime() : null;
  if (aDue !== null && bDue !== null) return aDue - bDue;
  if (aDue !== null) return -1;
  if (bDue !== null) return 1;
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

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

function isOverdue(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  if (target.getTime() === today.getTime()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (target.getTime() === tomorrow.getTime()) return "tomorrow";
  if (target.getTime() < today.getTime()) {
    const days = Math.round((today.getTime() - target.getTime()) / 86_400_000);
    return `${days}d ago`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
