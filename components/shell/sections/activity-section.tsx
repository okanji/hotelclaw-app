"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  CheckCheck,
  Hash,
  Inbox,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarGroup, SidebarGroupContent } from "@/components/ui/sidebar";
import { NotificationItem } from "@/components/shell/notification-item";
import { useNotifications } from "@/components/shell/use-notifications";
import type { NotificationRow } from "@/lib/notifications/types";

type DateGroup = {
  key: string;
  label: string;
  items: NotificationRow[];
};

/** "Today" / "Yesterday" / "Monday, May 11". */
function dateLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Slack-Activity-style feed filters. Categories mirror the main-pane
 *  timeline (`activity-hub`'s `matchesFilter`) so the two surfaces agree on
 *  what "Tasks" or "Channels" means. Icons match Slack's tab bar, where every
 *  tab except "All" carries a small leading glyph. */
type FeedFilter = "all" | "mentions" | "tasks" | "channels";

const FEED_TABS: { id: FeedFilter; label: string; icon: LucideIcon | null }[] = [
  { id: "all", label: "All", icon: null },
  { id: "mentions", label: "Mentions", icon: AtSign },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "channels", label: "Channels", icon: Hash },
];

function matchesFeedFilter(n: NotificationRow, filter: FeedFilter): boolean {
  if (filter === "all") return true;
  if (filter === "mentions") return n.type === "mention";
  if (filter === "tasks")
    return n.type === "task_assigned" || n.type === "task_unassigned";
  if (filter === "channels") return n.type === "channel_added";
  return true;
}

/** Bucket notifications (already newest-first) into consecutive date groups. */
function groupByDate(notifications: NotificationRow[]): DateGroup[] {
  const groups: DateGroup[] = [];
  let current: DateGroup | null = null;
  for (const n of notifications) {
    const d = new Date(n.created_at);
    const key = d.toDateString();
    if (!current || current.key !== key) {
      current = { key, label: dateLabel(d), items: [] };
      groups.push(current);
    }
    current.items.push(n);
  }
  return groups;
}

/**
 * Secondary-sidebar content for the Activity section: the full notification
 * feed grouped by date. Selecting a row marks it seen and navigates to
 * `/activity?n=<id>`, which the main pane (`ActivityView`) renders inline.
 *
 * Uses `useSearchParams` for the active highlight — wrap in `<Suspense>`.
 */
export function ActivitySection({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { notifications, unseenCount } = useNotifications(userId);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const visible = useMemo(
    () =>
      notifications.filter(
        (n) =>
          matchesFeedFilter(n, filter) && (!unreadOnly || !n.seen_at),
      ),
    [notifications, filter, unreadOnly],
  );
  const groups = useMemo(() => groupByDate(visible), [visible]);

  const base = `/p/${propertyId}/activity`;
  const onActivity = pathname === base || pathname.startsWith(`${base}/`);
  const selectedId = onActivity ? searchParams.get("n") : null;

  function markSeen(ids: string[]) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const now = new Date().toISOString();
    qc.setQueryData<NotificationRow[]>(["notifications", userId], (prev) =>
      (prev ?? []).map((n) =>
        idSet.has(n.id) && !n.seen_at ? { ...n, seen_at: now } : n,
      ),
    );
  }

  function handleSelect(n: NotificationRow) {
    router.push(`${base}?n=${n.id}`);
    if (n.seen_at) return;
    markSeen([n.id]);
    void fetch("/api/me/notifications/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [n.id] }),
    }).catch(() => {});
  }

  function markAllRead() {
    const unseen = notifications.filter((n) => !n.seen_at);
    if (unseen.length === 0) return;
    markSeen(unseen.map((n) => n.id));
    void fetch("/api/me/notifications/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {
      qc.invalidateQueries({ queryKey: ["notifications", userId] });
    });
  }

  return (
    <SidebarGroup>
      {/* Header — Slack's prominent "Activity" title with the action on the
          right (Slack puts a settings gear here; mark-all-read is our
          equivalent always-available action). */}
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <h2 className="text-[1.0625rem] font-semibold tracking-tight text-foreground">
          Activity
        </h2>
        {unseenCount > 0 ? (
          <button
            type="button"
            title="Mark all read"
            onClick={markAllRead}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <CheckCheck className="size-4" />
          </button>
        ) : null}
      </div>

      {/* Tab bar — Slack's underline tabs with leading glyphs. */}
      <div
        role="tablist"
        aria-label="Activity filter"
        className="flex items-center gap-4 overflow-x-auto border-b border-border px-2"
      >
        {FEED_TABS.map((tab) => {
          const tabActive = tab.id === filter;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tabActive}
              onClick={() => setFilter(tab.id)}
              className={cn(
                "relative flex items-center gap-1.5 pb-2 text-[0.8125rem] font-medium whitespace-nowrap transition-colors",
                tabActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
              {tab.label}
              {tabActive ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Toolbar — Slack's filter row; the Unreads toggle is the functional
          piece of it here. */}
      <div className="flex items-center px-2 py-2">
        <button
          type="button"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors",
            unreadOnly
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <Inbox className="size-3.5 shrink-0" />
          Unreads
        </button>
      </div>

      <SidebarGroupContent>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center">
            <CheckCheck className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground">
              Mentions, task assignments, and invites show up here.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            {unreadOnly
              ? "Nothing unread here."
              : "Nothing in this filter yet."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              {/* Slack's date separator — a bordered pill centered over a
                  hairline. */}
              <div className="relative flex items-center justify-center py-3">
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-1/2 h-px bg-border"
                />
                <span className="relative inline-flex items-center rounded-full border border-border bg-sidebar px-2.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                  {group.label}
                </span>
              </div>
              {/* Slack groups the day's items into one bordered card with
                  hairline dividers between rows. */}
              <ul
                role="list"
                className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
              >
                {group.items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    propertyId={propertyId}
                    active={n.id === selectedId}
                    onSelect={() => handleSelect(n)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
