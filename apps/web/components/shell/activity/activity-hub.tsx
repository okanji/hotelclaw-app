"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useNotifications,
  useNotificationActions,
} from "@/components/shell/use-notifications";
import {
  notificationView,
  type NotificationView,
} from "@/components/shell/notification-item";
import {
  matchesView,
  notificationTaskId,
  type ActivityViewId,
} from "./views";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageShell } from "@/components/ui/page-shell";
import type { NotificationRow } from "@/lib/notifications/types";

/**
 * The Activity feed — the single notification list, shown in the main pane for
 * whichever view the header tabs selected (`?view=`). One feed, one place: the
 * tabs say *which slice*, this renders *the rows*. Clicking a row marks it
 * read and opens it: a task notification opens beside the list when the host
 * accepts (`onOpenTask` returns true on wide screens), anything else navigates
 * to where it actually lives (channel, project, insights page…). Hover a
 * row for a one-click Mark read (unread rows) or Mark unread (read rows) that
 * doesn't open it.
 */
export function ActivityFeed({
  propertyId,
  userId,
  view,
  selectedId = null,
  onOpenTask,
}: {
  propertyId: string;
  userId: string;
  view: ActivityViewId;
  /** The row whose task is open in the host's split pane, if any. */
  selectedId?: string | null;
  /** Open a task beside the list; return false to fall back to navigating. */
  onOpenTask?: (notificationId: string, taskId: string) => boolean;
}) {
  const router = useRouter();
  const { notifications } = useNotifications(userId);
  const { markRead, markUnread } = useNotificationActions(userId);

  const groups = useMemo(() => {
    const visible = notifications.filter((n) => matchesView(n, view));
    return groupByDate(visible);
  }, [notifications, view]);

  function handleSelect(n: NotificationRow) {
    markRead(n);
    const taskId = notificationTaskId(n);
    if (taskId && onOpenTask?.(n.id, taskId)) return;
    const target = notificationView(n, propertyId).href;
    if (target) router.push(target);
  }

  if (groups.length === 0) {
    return <EmptyFeed view={view} />;
  }

  return (
    // One page width for the feed — `PageShell` owns it (was a bare
    // `max-w-3xl`, the last surviving page-container one-off outside the
    // guest world). The `PageHeader` above is full-pane chrome, so this
    // column is the page's only content edge.
    <PageShell className="py-6 sm:py-8">
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
                  selected={n.id === selectedId}
                  onSelect={() => handleSelect(n)}
                  onMarkRead={() => markRead(n)}
                  onMarkUnread={() => markUnread(n)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

/* ── Row ──────────────────────────────────────────────────────────────────── */

function FeedRow({
  notification,
  propertyId,
  selected,
  onSelect,
  onMarkRead,
  onMarkUnread,
}: {
  notification: NotificationRow;
  propertyId: string;
  selected: boolean;
  onSelect: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
}) {
  const v: NotificationView = notificationView(notification, propertyId);
  const unseen = !notification.seen_at;
  const hasTarget = Boolean(v.href);

  return (
    // The hover action is a SIBLING of the row button (no nested buttons);
    // while it shows, the row's time cluster yields its slot to it.
    <li className="group/row relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent",
          selected && "bg-accent",
        )}
      >
        <span
          className={cn(
            // An initials chip is an IDENTITY, not an action — `--primary` is
            // now Notion blue and reserved for things you can press or that
            // are active (notion-spec-v2 §0.2), so a blue-tinted avatar read
            // as "this row is selected". Warm neutral in both branches; the
            // actor/system distinction is carried by initials vs glyph.
            "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold select-none",
            v.actor
              ? "bg-accent-pressed text-secondary-ink"
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
            <span
              className={cn(
                // Every row has a hover action now (Mark read / Mark unread),
                // so the time cluster always yields its slot to it.
                "flex shrink-0 items-center gap-1.5 pt-0.5 text-xs tabular-nums text-muted-foreground",
                "group-hover/row:invisible group-has-[:focus-visible]/row:invisible",
              )}
            >
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
                  // The unread marker is the NOTIFICATION signal, not the
                  // action colour — same hue as the rail's unread badge.
                  className="size-1.5 rounded-full bg-notification"
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
      <button
        type="button"
        onClick={unseen ? onMarkRead : onMarkUnread}
        title={unseen ? "Mark read" : "Mark unread"}
        aria-label={unseen ? "Mark read" : "Mark unread"}
        className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground opacity-0 transition-[opacity,background-color] group-hover/row:opacity-100 hover:bg-accent-pressed hover:text-foreground focus-visible:opacity-100 focus-visible:shadow-focus focus-visible:outline-none"
      >
        {unseen ? (
          <Check className="size-3.5" />
        ) : (
          <CircleDot className="size-3.5" />
        )}
        {unseen ? "Mark read" : "Mark unread"}
      </button>
    </li>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

const EMPTY_COPY: Record<ActivityViewId, string> = {
  inbox: "You're all caught up. Mentions, tasks, and alerts land here.",
  unread: "Nothing unread — you're all caught up.",
  workspace: "No changes recorded yet.",
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
