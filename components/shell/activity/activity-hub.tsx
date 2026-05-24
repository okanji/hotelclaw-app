"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AtSign,
  Bell,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleDot,
  FileText,
  Hash,
  ListChecks,
  Mail,
  MessageSquareText,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  UserMinus,
  Video,
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
 * notification is selected in the sidebar. Pulls from the same warmed
 * caches the rail already prefetches (notifications, tasks, calendar,
 * documents), so first paint is hydrated.
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
  const events = useMemo(
    () => calendarQuery.data ?? [],
    [calendarQuery.data],
  );

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
    <div className="@container/hub min-h-full bg-background">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8 @3xl/hub:px-10 @3xl/hub:py-10">
        <GreetingHeader
          userName={userName}
          counts={todayCounts}
        />

        <UpNextSection items={upNext} propertyId={propertyId} />

        <div className="grid grid-cols-1 gap-8 @3xl/hub:grid-cols-5 @3xl/hub:gap-10">
          <div className="@3xl/hub:col-span-3">
            <ActivityTimeline
              notifications={notifications}
              propertyId={propertyId}
            />
          </div>
          <div className="flex flex-col gap-8 @3xl/hub:col-span-2">
            <YourTasksSection tasks={myTasks} propertyId={propertyId} />
            <RecentDocsSection docs={docs} propertyId={propertyId} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Greeting + stat strip                                                     */
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
  const { greeting, Icon } = greetingForHour(hour);
  const firstName = (userName ?? "").split(" ")[0]?.trim() || null;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-pretty text-2xl font-semibold tracking-tight text-foreground @3xl/hub:text-3xl">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {today} · Here&apos;s what&apos;s happening across your workspace.
          </p>
        </div>
      </div>

      <StatStrip counts={counts} />
    </header>
  );
}

function StatStrip({
  counts,
}: {
  counts: {
    unread: number;
    mentionsToday: number;
    tasksDueToday: number;
    meetingsToday: number;
  };
}) {
  const items: Array<{ label: string; value: number; icon: React.ReactNode }> =
    [
      {
        label: "Unread",
        value: counts.unread,
        icon: <Bell className="size-3.5" />,
      },
      {
        label: "Mentions today",
        value: counts.mentionsToday,
        icon: <AtSign className="size-3.5" />,
      },
      {
        label: "Tasks due today",
        value: counts.tasksDueToday,
        icon: <ListChecks className="size-3.5" />,
      },
      {
        label: "Meetings today",
        value: counts.meetingsToday,
        icon: <Video className="size-3.5" />,
      },
    ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border @xl/hub:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col gap-1 bg-card px-4 py-3"
        >
          <dt className="flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
            <span aria-hidden="true">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </dt>
          <dd className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
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
    <section aria-labelledby="up-next-heading" className="flex flex-col gap-3">
      <SectionTitle
        id="up-next-heading"
        title="Up next"
        action={
          <Link
            href={`/p/${propertyId}/calendar`}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Open calendar
          </Link>
        }
      />
      {items.length === 0 ? (
        <EmptyRow icon={<CalendarDays className="size-4" />}>
          Nothing scheduled for the rest of today.
        </EmptyRow>
      ) : (
        <ul role="list" className="divide-y divide-border rounded-xl border border-border bg-card">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <Link
                href={item.href}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <TimeBlock
                  start={item.kind === "meeting" ? item.start : item.due}
                  allDay={item.kind === "meeting" ? item.allDay : false}
                />
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  {item.kind === "meeting" ? (
                    <Video className="size-3.5" />
                  ) : (
                    <ListChecks className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.kind === "meeting"
                      ? meetingSubline(item)
                      : `Task · ${capitalize(item.priority)} priority`}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TimeBlock({ start, allDay }: { start: string; allDay: boolean }) {
  if (allDay) {
    return (
      <div className="flex w-14 shrink-0 flex-col items-start">
        <span className="text-[11px] font-medium text-muted-foreground">
          All day
        </span>
      </div>
    );
  }
  const d = new Date(start);
  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="flex w-14 shrink-0 flex-col items-start">
      <span className="text-sm font-semibold tabular-nums text-foreground">
        {time.replace(/\s?(AM|PM)/i, "")}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {time.match(/AM|PM/i)?.[0] ?? ""}
      </span>
    </div>
  );
}

function meetingSubline(item: Extract<UpNextItem, { kind: "meeting" }>) {
  if (item.location) return `Meeting · ${item.location}`;
  const minutes = Math.round(
    (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60000,
  );
  if (minutes <= 0) return "Meeting";
  if (minutes < 60) return `Meeting · ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return `Meeting · ${hours}h${rem ? ` ${rem}m` : ""}`;
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
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <SectionTitle id="activity-heading" title="Recent activity" />
      <FilterTabs value={filter} onChange={setFilter} />
      {filtered.length === 0 ? (
        <EmptyRow icon={<Sparkles className="size-4" />}>
          You&apos;re all caught up.
        </EmptyRow>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <ol
                role="list"
                className="relative flex flex-col gap-0 border-l border-border pl-5"
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
    </section>
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
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
    <li className="relative pb-5 last:pb-0">
      <span
        aria-hidden="true"
        className={cn(
          "absolute -left-[26px] top-1 flex size-4 items-center justify-center rounded-full border-2 border-background",
          unseen ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
            unseen
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {view.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-sm leading-snug text-foreground">
              {view.lead}
            </p>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {relativeTime(notification.created_at)}
            </span>
          </div>
          {view.sub ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {view.sub}
            </p>
          ) : null}
          {view.href ? (
            <Link
              href={view.href}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {view.cta ?? "Open"}
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
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
    <section
      aria-labelledby="your-tasks-heading"
      className="flex flex-col gap-3"
    >
      <SectionTitle
        id="your-tasks-heading"
        title="Your active tasks"
        action={
          <Link
            href={`/p/${propertyId}/tasks`}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Open board
          </Link>
        }
      />
      {tasks.length === 0 ? (
        <EmptyRow icon={<CheckCircle2 className="size-4" />}>
          No active tasks assigned to you.
        </EmptyRow>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={`/p/${propertyId}/tasks/${task.id}`}
                className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-foreground/25"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center",
                    statusColor(task.status),
                  )}
                >
                  <StatusIcon status={task.status} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {task.title}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="capitalize">
                      {task.status.replace("_", " ")}
                    </span>
                    {task.priority !== "none" && task.priority !== "low" ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className={cn(
                            "font-medium",
                            priorityColor(task.priority),
                          )}
                        >
                          {capitalize(task.priority)}
                        </span>
                      </>
                    ) : null}
                    {task.due_at ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={cn(dueColor(task.due_at))}>
                          Due {formatDue(task.due_at)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusIcon({ status }: { status: Task["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="size-4" />;
    case "in_progress":
      return <CircleDot className="size-4" />;
    case "blocked":
      return <Circle className="size-4" />;
    default:
      return <Circle className="size-4" />;
  }
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
    <section
      aria-labelledby="recent-docs-heading"
      className="flex flex-col gap-3"
    >
      <SectionTitle
        id="recent-docs-heading"
        title="Recent documents"
        action={
          <Link
            href={`/p/${propertyId}/documents`}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Open docs
          </Link>
        }
      />
      {top.length === 0 ? (
        <EmptyRow icon={<FileText className="size-4" />}>
          No documents yet.
        </EmptyRow>
      ) : (
        <ul role="list" className="flex flex-col">
          {top.map((doc, i) => (
            <li
              key={doc.id}
              className={cn(
                "py-2",
                i > 0 && "border-t border-border/60",
              )}
            >
              <Link
                href={`/p/${propertyId}/documents/${doc.id}`}
                className="group flex items-center gap-3"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                >
                  <FileText className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {doc.title || "Untitled"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Updated {relativeTime(doc.updated_at)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function SectionTitle({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2
        id={id}
        className="text-sm font-semibold tracking-tight text-foreground"
      >
        {title}
      </h2>
      {action}
    </div>
  );
}

function EmptyRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
      >
        {icon}
      </span>
      <span>{children}</span>
    </div>
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
            <strong className="font-semibold">
              {p.title ?? "a meeting"}
            </strong>
          </>
        ),
        sub: p.preview ?? null,
        href: p.meetingId
          ? `/p/${propertyId}/meetings/${p.meetingId}`
          : null,
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

function dueColor(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const dayMs = 86_400_000;
  if (t < now) return "text-destructive font-medium";
  if (t - now < dayMs) return "text-amber-600 dark:text-amber-400 font-medium";
  return "";
}

function statusColor(status: Task["status"]): string {
  switch (status) {
    case "done":
      return "text-emerald-600 dark:text-emerald-400";
    case "in_progress":
      return "text-sky-600 dark:text-sky-400";
    case "blocked":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function priorityColor(priority: Task["priority"]): string {
  switch (priority) {
    case "urgent":
      return "text-destructive";
    case "high":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-foreground";
  }
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
