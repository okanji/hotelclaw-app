"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
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
  const groups = useMemo(() => groupByDate(notifications), [notifications]);

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
      <SidebarGroupLabel>Activity</SidebarGroupLabel>
      {unseenCount > 0 ? (
        <SidebarGroupAction title="Mark all read" onClick={markAllRead}>
          <CheckCheck />
        </SidebarGroupAction>
      ) : null}
      <SidebarGroupContent>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center">
            <CheckCheck className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground">
              Mentions, task assignments, and invites show up here.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <div className="flex items-center justify-center py-2">
                <span className="rounded-full bg-sidebar-accent px-2.5 py-0.5 text-[11px] font-medium text-sidebar-foreground/70">
                  {group.label}
                </span>
              </div>
              <ul role="list" className="flex flex-col gap-2">
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
