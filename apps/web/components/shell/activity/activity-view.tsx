"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, X } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import {
  useNotifications,
  useNotificationActions,
} from "@/components/shell/use-notifications";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import { ActivityLogFeed } from "@/components/activity/activity-log";
import { TaskRoom } from "@/components/tasks/task-room";
import { TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { cn } from "@/lib/utils";
import { ActivityFeed } from "./activity-hub";
import {
  matchesView,
  NOTIFICATION_VIEWS,
  unreadCountsByView,
  viewDef,
  viewFromParam,
  WORKSPACE_VIEWS,
  type ActivityViewId,
} from "./views";

/** Wide enough for list + task side by side (the sidebar already eats ~260px). */
const SPLIT_QUERY = "(min-width: 1280px)";

/**
 * Activity main pane — the inbox. The page owns its controls (Linear's
 * inbox): the header carries the view tabs (All / Unread / Mentions / … /
 * All activity, each with its unread count), Mark all as read, and the
 * unread meta; the sidebar's Inbox node keeps only a few shortcuts, because
 * a collapsed row would otherwise hide the filters.
 *
 * Task notifications open in a split pane beside the list on wide screens
 * (the real `TaskRoom`, embedded); everything else — and every row on a
 * narrow screen — navigates to where it lives.
 *
 * The unread count is topbar *meta*, not a control: 14px/400 faint, the same
 * ramp as Notion's "Edited 2y ago" (docs/notion-spec.md §3).
 */
export function ActivityView({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const router = useRouter();
  const view = viewFromParam(useSearchParams().get("view"));
  const def = viewDef(view);
  const Icon = def.icon;
  const { notifications, unseenCount } = useNotifications(userId);
  const { markSeen, markAllRead } = useNotificationActions(userId);
  const [openTask, setOpenTask] = useState<
    { notificationId: string; taskId: string } | null
  >(null);

  const unreadByView = useMemo(
    () => unreadCountsByView(notifications),
    [notifications],
  );
  const viewUnread = view === "workspace" ? 0 : unreadByView[view];

  const base = `/p/${propertyId}/activity`;
  function go(next: ActivityViewId) {
    setOpenTask(null);
    router.replace(next === "inbox" ? base : `${base}?view=${next}`, {
      scroll: false,
    });
  }

  // "Mark all as read" means THIS view: on All / Unread that's everything
  // (one `all: true` call); on a filter it's only the rows the filter shows,
  // so clearing Mentions doesn't silently swallow an unread alert.
  function markViewRead() {
    if (view === "inbox" || view === "unread") {
      markAllRead();
      return;
    }
    const ids = notifications
      .filter((n) => !n.seen_at && matchesView(n, view))
      .map((n) => n.id);
    if (ids.length === 0) return;
    markSeen(ids);
    void fetch("/api/me/notifications/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {});
  }

  function openInSplit(notificationId: string, taskId: string) {
    if (!window.matchMedia(SPLIT_QUERY).matches) return false;
    setOpenTask({ notificationId, taskId });
    return true;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        title={view === "inbox" ? "Inbox" : def.label}
        icon={<Icon />}
        meta={
          view === "workspace"
            ? "Everything that changed, and who changed it"
            : unseenCount > 0
              ? `${unseenCount} unread`
              : undefined
        }
        actions={
          view !== "workspace" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={markViewRead}
              disabled={viewUnread === 0}
              title={
                view === "inbox" || view === "unread"
                  ? "Mark every notification read"
                  : `Mark every ${def.label.toLowerCase()} notification read`
              }
            >
              <CheckCheck className="size-4" />
              Mark all as read
            </Button>
          ) : null
        }
      />
      <TabNav
        variant="pill"
        aria-label="Inbox views"
        className="overflow-x-auto px-(--page-gutter) pb-2 [scrollbar-width:none]"
      >
        {NOTIFICATION_VIEWS.map((v) => (
          <ViewTab
            key={v.id}
            label={v.label}
            icon={<v.icon className={cn(v.attention && "text-warning")} />}
            active={view === v.id}
            count={v.id === "inbox" || v.id === "unread" ? 0 : unreadByView[v.id]}
            onClick={() => go(v.id)}
          />
        ))}
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
        {WORKSPACE_VIEWS.map((v) => (
          <ViewTab
            key={v.id}
            label={v.label}
            icon={<v.icon />}
            active={view === v.id}
            count={0}
            onClick={() => go(v.id)}
          />
        ))}
      </TabNav>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {view === "workspace" ? (
            <PageShell className="py-6 sm:py-8">
              <ActivityLogFeed
                propertyId={propertyId}
                scope={{ kind: "property" }}
                meId={userId}
                showProject
              />
            </PageShell>
          ) : (
            <ActivityFeed
              propertyId={propertyId}
              userId={userId}
              view={view}
              selectedId={openTask?.notificationId ?? null}
              onOpenTask={openInSplit}
            />
          )}
        </div>
        {openTask && view !== "workspace" ? (
          <aside className="hidden min-h-0 w-[min(46%,720px)] shrink-0 flex-col border-l border-border xl:flex">
            <div className="flex h-9 shrink-0 items-center justify-end px-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpenTask(null)}
                aria-label="Close task"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SplitTask
                key={openTask.taskId}
                propertyId={propertyId}
                taskId={openTask.taskId}
              />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function ViewTab({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <TabNavItem active={active} onClick={onClick}>
      {icon}
      {label}
      {count > 0 ? (
        <span className="text-xs text-faint-foreground tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </TabNavItem>
  );
}

/**
 * TaskRoom reads the shared `["tasks", propertyId]` list cache, which has no
 * realtime invalidation — a task assigned to you seconds ago may not be in
 * this tab's copy yet. Refetch once when the id is missing (same handshake
 * as the chat artifact panel); if it's still absent, TaskRoom's not-found
 * state is telling the truth.
 */
function SplitTask({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const qc = useQueryClient();
  const { data: tasks, isFetching } = useQuery(tasksQueryOptions(propertyId));
  const inCache = tasks?.some((t) => t.id === taskId) ?? false;
  // Flips once the one refetch settles (set from the promise, not the
  // effect body). The component is keyed on taskId, so it never resets.
  const [refetched, setRefetched] = useState(false);
  const loaded = !!tasks;

  useEffect(() => {
    if (!loaded || inCache) return;
    let live = true;
    void qc
      .refetchQueries({ queryKey: ["tasks", propertyId] })
      .finally(() => {
        if (live) setRefetched(true);
      });
    return () => {
      live = false;
    };
  }, [loaded, inCache, qc, propertyId]);

  if (!inCache && (isFetching || !refetched)) {
    return <TaskDetailSkeleton />;
  }
  return <TaskRoom propertyId={propertyId} taskId={taskId} variant="embedded" />;
}
