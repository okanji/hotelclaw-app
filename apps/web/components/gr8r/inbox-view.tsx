"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  CheckCheck,
  Inbox,
  Mail,
  MailOpen,
  PanelRightOpen,
  SquareArrowOutUpRight,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import {
  useNotifications,
  useNotificationActions,
} from "@/components/shell/use-notifications";
import {
  notificationView,
  type NotificationView,
} from "@/components/shell/notification-item";
import {
  FILTER_VIEWS,
  matchesView,
  notificationTaskId,
  unreadCountsByView,
  type ActivityViewId,
} from "@/components/shell/activity/views";
import { TaskRoom } from "@/components/tasks/task-room";
import { TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import type { NotificationRow } from "@/lib/notifications/types";
import { Gi } from "./icon";
import {
  NotifAvatar,
  NotifTypeGlyph,
  ago,
  isAlert,
  persistRead,
} from "./inbox-shared";

/** Wide enough for list + the real task detail side by side. */
const SPLIT_QUERY = "(min-width: 1280px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** gr8r's category tabs, over our inbox views (Unread is the toggle). */
const CATS: { id: ActivityViewId; label: string }[] = [
  { id: "inbox", label: "All" },
  ...FILTER_VIEWS.map((v) => ({ id: v.id, label: v.label })),
];

const EMPTY_TEXT: Partial<Record<ActivityViewId, string>> = {
  inbox: "New mentions, assignments, and alerts will show up here.",
  mentions: "When someone @-mentions you, it shows up here.",
  tasks: "Assignments and reassignments appear here.",
  channels: "Channel adds show up here.",
  alerts: "Risks, escalations, and failures surface here.",
  reports: "Weekly summaries and meeting notes land here.",
  invites: "No invitations.",
};

/**
 * gr8r-studio `pageInbox` (src/pages/inbox.js): a two-pane inbox — the list
 * (category tabs, Unread toggle, Mark all as read, per-row read toggle) and a
 * preview pane. A task notification previews the real `TaskRoom` (embedded)
 * at ≥1280px; narrower, and for everything else, the preview carries an Open
 * button to where the notification lives. Below 900px the preview becomes a
 * full-screen overlay while something is selected (gr8r's own rule).
 *
 * URL contract (unchanged for the sidebar shortcuts): `?view=` picks the
 * category, `?view=unread` is All + Unread, `&unread=1` is Unread on a
 * category. `?view=workspace` (Activity) and the legacy `?view=triage`
 * redirect are rendered by
 * `ActivityView`, not here.
 */
export function Gr8rInbox({
  propertyId,
  userId,
  view,
  unreadParam,
}: {
  propertyId: string;
  userId: string;
  view: ActivityViewId;
  unreadParam: boolean;
}) {
  const router = useRouter();
  const { notifications, unseenCount } = useNotifications(userId);
  const { markSeen, markRead, markUnread, markAllRead } =
    useNotificationActions(userId);
  const [selId, setSelId] = useState<string | null>(null);
  const wide = useMediaQuery(SPLIT_QUERY);

  const cat: ActivityViewId = view === "unread" ? "inbox" : view;
  const unreadOnly = view === "unread" || unreadParam;

  const counts = useMemo(
    () => unreadCountsByView(notifications),
    [notifications],
  );
  const rows = useMemo(
    () =>
      notifications.filter(
        (n) => matchesView(n, cat) && (!unreadOnly || !n.seen_at),
      ),
    [notifications, cat, unreadOnly],
  );
  const sel = notifications.find((n) => n.id === selId) ?? null;

  const base = `/p/${propertyId}/activity`;
  function nav(nextCat: ActivityViewId, nextUnread: boolean) {
    let href = base;
    if (nextCat === "inbox") href = nextUnread ? `${base}?view=unread` : base;
    else
      href = `${base}?view=${nextCat}${nextUnread ? "&unread=1" : ""}`;
    router.replace(href, { scroll: false });
  }

  // Mark all as read = THIS category (All clears everything in one call).
  function markCatRead() {
    if (cat === "inbox") {
      markAllRead();
      return;
    }
    const ids = notifications
      .filter((n) => !n.seen_at && matchesView(n, cat))
      .map((n) => n.id);
    markSeen(ids);
    persistRead(ids);
  }

  function select(n: NotificationRow) {
    markRead(n);
    setSelId(n.id);
  }

  const catUnread = counts[cat] ?? 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        title="Inbox"
        icon={<Inbox />}
        meta={unseenCount > 0 ? `${unseenCount} unread` : undefined}
      />
      <div className="page flush" style={{ flex: "1 1 0", minHeight: 0 }}>
        <div
          className="inbox-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,420px) minmax(0,1fr)",
            flex: 1,
            minHeight: 0,
          }}
        >
          <style>{`@media(max-width:900px){.inbox-grid{grid-template-columns:minmax(0,1fr)!important}.inbox-prev{display:${sel ? "flex" : "none"}!important;position:fixed;inset:0;z-index:48;background:var(--g8-surface)}}`}</style>
          <div
            style={{
              borderRight: "1px solid var(--g8-border)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div className="row" style={{ padding: "18px var(--g8-gutter) 0" }}>
              <h1
                style={{
                  fontSize: "var(--g8-fs-xl)",
                  margin: 0,
                  fontWeight: 600,
                  letterSpacing: "-.015em",
                }}
              >
                Inbox
              </h1>
              <span className="sp" />
              <label
                className="row"
                style={{
                  fontSize: 12,
                  color: "var(--g8-text-2)",
                  gap: 6,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  className="toggle"
                  checked={unreadOnly}
                  onChange={(e) => nav(cat, e.target.checked)}
                />
                Unread
              </label>
              <button
                type="button"
                className="ibtn ibtn-sm"
                onClick={markCatRead}
                disabled={catUnread === 0}
                title="Mark all as read"
                aria-label="Mark all as read"
              >
                <Gi icon={CheckCheck} size={15} />
              </button>
            </div>
            <InboxTabs
              propertyId={propertyId}
              userId={userId}
              active={cat}
              counts={counts}
              onPick={(id) => {
                setSelId(null);
                nav(id, unreadOnly);
              }}
            />
            <div className="inbox-list">
              {rows.length ? (
                rows.map((n) => (
                  <InboxItem
                    key={n.id}
                    n={n}
                    v={notificationView(n, propertyId)}
                    on={sel?.id === n.id}
                    onSelect={() => select(n)}
                    onToggleRead={() => (n.seen_at ? markUnread(n) : markRead(n))}
                  />
                ))
              ) : (
                <div className="empty-state sm">
                  <div className="glyph">
                    <Gi icon={Inbox} size={20} />
                  </div>
                  <h2 className="es-h">You&apos;re all caught up.</h2>
                  <p>
                    {unreadOnly
                      ? "No unread notifications in this category."
                      : (EMPTY_TEXT[cat] ?? EMPTY_TEXT.inbox)}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div
            className="inbox-prev"
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            {sel ? (
              <InboxPreview
                key={sel.id}
                n={sel}
                v={notificationView(sel, propertyId)}
                propertyId={propertyId}
                wide={wide}
                onBack={() => setSelId(null)}
              />
            ) : (
              <div className="fullstate">
                <div className="box">
                  <div className="empty-state" style={{ padding: 0 }}>
                    <div className="glyph">
                      <Gi icon={MailOpen} size={20} />
                    </div>
                    <h2 className="es-h">Select a notification</h2>
                    <p>Read it and act on it without leaving your inbox.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The Inbox's tab strip — the notification categories, then Activity (the
 * workspace `activity_log` feed). Shared by the notification inbox and the
 * Activity tab, so the strip never drifts between them. `onPick` handles
 * notification categories (the inbox keeps its Unread toggle in the URL);
 * Activity is a plain URL swap. Triage is NOT here — it is part of Tasks
 * (`/triage`), as in Linear.
 */
export function InboxTabs({
  propertyId,
  userId,
  active,
  counts,
  onPick,
}: {
  propertyId: string;
  userId: string;
  active: ActivityViewId;
  /** Unread counts per category — computed by the caller when it has them. */
  counts?: Record<ActivityViewId, number>;
  onPick?: (id: ActivityViewId) => void;
}) {
  const router = useRouter();
  const { notifications } = useNotifications(userId);
  const ownCounts = useMemo(
    () => counts ?? unreadCountsByView(notifications),
    [counts, notifications],
  );
  const base = `/p/${propertyId}/activity`;
  const go = (href: string) => router.replace(href, { scroll: false });

  return (
    <div className="tabs inbox-tabs" role="tablist">
      {CATS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={active === c.id}
          className={`tab ${active === c.id ? "on" : ""}`}
          onClick={() =>
            onPick
              ? onPick(c.id)
              : go(c.id === "inbox" ? base : `${base}?view=${c.id}`)
          }
        >
          {c.label}
          {ownCounts[c.id] ? (
            <span className="cnt">
              {ownCounts[c.id] > 99 ? "99+" : ownCounts[c.id]}
            </span>
          ) : null}
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected={active === "workspace"}
        className={`tab ${active === "workspace" ? "on" : ""}`}
        onClick={() => go(`${base}?view=workspace`)}
        title="Everything that changed across the workspace, and who changed it"
      >
        <Gi icon={Activity} size={13} />
        Activity
      </button>
    </div>
  );
}

/* ── gr8r `inboxItem` ─────────────────────────────────────────────────────── */

function InboxItem({
  n,
  v,
  on,
  onSelect,
  onToggleRead,
}: {
  n: NotificationRow;
  v: NotificationView;
  on: boolean;
  onSelect: () => void;
  onToggleRead: () => void;
}) {
  const unread = !n.seen_at;
  return (
    <div
      className="row"
      role="button"
      tabIndex={0}
      aria-current={on ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        alignItems: "flex-start",
        gap: 10,
        padding: "12px var(--g8-gutter)",
        borderBottom: "1px solid var(--g8-divider)",
        cursor: "pointer",
        position: "relative",
        background: on ? "var(--g8-surface-2)" : undefined,
      }}
    >
      {unread ? (
        <span
          aria-label="Unread"
          style={{
            position: "absolute",
            left: 6,
            top: 22,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--g8-accent)",
          }}
        />
      ) : null}
      <NotifAvatar n={n} v={v} />
      <div className="grow" style={{ fontSize: 13, lineHeight: 1.45 }}>
        <div className={unread ? undefined : "muted"}>{v.lead}</div>
        {v.sub ? (
          <div
            className="trunc muted"
            style={{ fontSize: 12.5, marginTop: 2 }}
          >
            {v.sub}
          </div>
        ) : null}
        <div
          className="row"
          style={{
            gap: 6,
            marginTop: 5,
            fontSize: 11.5,
            color: "var(--g8-text-3)",
          }}
        >
          <NotifTypeGlyph n={n} />
          {v.channel ? <span>{v.channel}</span> : <span>{v.kicker}</span>}
          <span>·</span>
          <span>{ago(n.created_at)}</span>
        </div>
      </div>
      <button
        type="button"
        className="ibtn ibtn-xs"
        onClick={(e) => {
          e.stopPropagation();
          onToggleRead();
        }}
        title={unread ? "Mark as read" : "Mark as unread"}
        aria-label={unread ? "Mark as read" : "Mark as unread"}
      >
        <Gi icon={unread ? MailOpen : Mail} size={13} />
      </button>
    </div>
  );
}

/* ── gr8r `inboxPreview` ──────────────────────────────────────────────────── */

function InboxPreview({
  n,
  v,
  propertyId,
  wide,
  onBack,
}: {
  n: NotificationRow;
  v: NotificationView;
  propertyId: string;
  wide: boolean;
  onBack: () => void;
}) {
  const taskId = notificationTaskId(n);

  if (taskId) {
    return (
      <>
        <div
          className="row"
          style={{
            height: 46,
            padding: "0 16px",
            borderBottom: "1px solid var(--g8-border)",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="ibtn ibtn-sm"
            onClick={onBack}
            aria-label="Back"
          >
            <Gi icon={ArrowLeft} size={15} />
          </button>
          <span className="muted trunc" style={{ fontSize: 12.5 }}>
            {v.kicker}
          </span>
          <span className="sp" />
          <Link
            href={`/p/${propertyId}/tasks/${taskId}`}
            className="btn btn-sm btn-secondary"
          >
            <Gi icon={PanelRightOpen} size={14} />
            Open task
          </Link>
        </div>
        {wide ? (
          <div style={{ minHeight: 0, flex: 1, overflowY: "auto" }}>
            <SplitTask key={taskId} propertyId={propertyId} taskId={taskId} />
          </div>
        ) : (
          <div style={{ padding: "24px 28px", maxWidth: 720, width: "100%" }}>
            <h2
              style={{
                fontSize: "var(--g8-fs-xl)",
                margin: "0 0 10px",
                fontWeight: 600,
                letterSpacing: "-.015em",
              }}
            >
              {v.sub ?? v.preview ?? "Task"}
            </h2>
            <p className="muted" style={{ margin: "0 0 14px" }}>
              {v.lead}
            </p>
            <div className="faint" style={{ fontSize: 11.5 }}>
              {ago(n.created_at)}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ padding: "24px 28px" }}>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={onBack}
        style={{ margin: "-4px 0 12px -8px" }}
      >
        <Gi icon={ArrowLeft} size={14} />
        Back
      </button>
      <div className={isAlert(n) ? "alert danger" : "alert"}>
        {isAlert(n) ? (
          <Gi icon={TriangleAlert} size={16} />
        ) : (
          <NotifTypeGlyph n={n} />
        )}
        <div>
          <b>{v.lead}</b>
          {v.sub ? (
            <div className="muted" style={{ marginTop: 2 }}>
              {v.sub}
            </div>
          ) : null}
          <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
            {v.channel ? `${v.channel} · ` : ""}
            {ago(n.created_at)}
          </div>
        </div>
      </div>
      {v.href ? (
        <div style={{ marginTop: 14 }}>
          <Link href={v.href} className="btn btn-secondary">
            <Gi icon={SquareArrowOutUpRight} size={14} />
            Open
          </Link>
        </div>
      ) : null}
    </div>
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
