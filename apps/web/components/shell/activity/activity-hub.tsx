"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useNotifications,
  useNotificationActions,
} from "@/components/shell/use-notifications";
import {
  notificationView,
  type NotificationView,
} from "@/components/shell/notification-item";
import { matchesView, type ActivityViewId } from "./views";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { NotificationRow } from "@/lib/notifications/types";

/**
 * The Activity feed — the single notification list, shown in the main pane for
 * whichever view the sidebar selected (`?view=`). One feed, one place: the
 * sidebar says *which slice*, this renders *the rows*. Clicking a row marks it
 * read and navigates to where it actually lives (the task, channel, project,
 * insights page…), so nothing dead-ends on an inline preview.
 */
export function ActivityFeed({
  propertyId,
  userId,
  view,
}: {
  propertyId: string;
  userId: string;
  view: ActivityViewId;
}) {
  const router = useRouter();
  const { notifications } = useNotifications(userId);
  const { markRead } = useNotificationActions(userId);

  const groups = useMemo(() => {
    const visible = notifications.filter((n) => matchesView(n, view));
    return groupByDate(visible);
  }, [notifications, view]);

  function handleSelect(n: NotificationRow) {
    markRead(n);
    const target = notificationView(n, propertyId).href;
    if (target) router.push(target);
  }

  if (groups.length === 0) {
    return <EmptyFeed view={view} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
      <div className="flex flex-col gap-7">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-1.5">
            <Eyebrow tone="brand" className="px-3">
              {group.label}
            </Eyebrow>
            <ul
              role="list"
              className="flex flex-col divide-y divide-border"
            >
              {group.items.map((n) => (
                <FeedRow
                  key={n.id}
                  notification={n}
                  propertyId={propertyId}
                  onSelect={() => handleSelect(n)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ── Row ──────────────────────────────────────────────────────────────────── */

function FeedRow({
  notification,
  propertyId,
  onSelect,
}: {
  notification: NotificationRow;
  propertyId: string;
  onSelect: () => void;
}) {
  const v: NotificationView = notificationView(notification, propertyId);
  const unseen = !notification.seen_at;
  const hasTarget = Boolean(v.href);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="group/row flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold select-none",
            v.actor
              ? "bg-primary/10 text-primary"
              : "bg-muted text-foreground/70 [&_svg]:size-4",
          )}
          aria-hidden="true"
        >
          {v.actor ? initials(v.actor) : v.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <p
              className={cn(
                "min-w-0 flex-1 text-sm leading-5 [&_strong]:text-foreground",
                unseen ? "text-foreground" : "text-foreground/70",
              )}
            >
              {v.lead}
            </p>
            <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs tabular-nums text-muted-foreground">
              {hasTarget ? (
                <span
                  aria-hidden="true"
                  className="font-medium text-foreground/60 opacity-0 transition-opacity group-hover/row:opacity-100"
                >
                  Open →
                </span>
              ) : null}
              {unseen ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-primary"
                />
              ) : null}
              {relativeTime(notification.created_at)}
            </span>
          </div>
          {v.sub ? (
            <p className="mt-0.5 line-clamp-1 text-sm leading-5 text-muted-foreground">
              {v.sub}
            </p>
          ) : null}
          {v.channel ? (
            <span className="mt-1.5 inline-flex items-center rounded-md bg-muted px-1.5 py-px text-xs font-medium text-muted-foreground">
              {v.channel}
            </span>
          ) : null}
        </div>
      </button>
    </li>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

const EMPTY_COPY: Record<ActivityViewId, string> = {
  inbox: "You're all caught up. Mentions, tasks, and alerts land here.",
  unread: "Nothing unread — you're all caught up.",
  mentions: "No mentions yet. When someone @-mentions you, it shows up here.",
  tasks: "No task activity. Assignments and reassignments appear here.",
  channels: "No channel activity. Channel adds show up here.",
  alerts: "No alerts. Risks, escalations, and failures surface here.",
  reports: "No reports yet. Weekly summaries and meeting notes land here.",
  invites: "No invitations.",
};

function EmptyFeed({ view }: { view: ActivityViewId }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CheckCheck className="size-5" />
      </span>
      <p className="max-w-[36ch] text-sm text-pretty text-muted-foreground">
        {EMPTY_COPY[view]}
      </p>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

type DayGroup = { key: string; label: string; items: NotificationRow[] };

/** Bucket already-newest-first rows into consecutive date groups. */
function groupByDate(items: NotificationRow[]): DayGroup[] {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const groups: DayGroup[] = [];
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
      groups.push(current);
    }
    current.items.push(n);
  }
  return groups;
}

/** "Marco Rossi" → "MR" for the actor avatar. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Compact relative stamp — "now", "5m", "22h", "3d", then a short date. */
function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
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
