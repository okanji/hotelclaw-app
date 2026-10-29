"use client";

import {
  AtSign,
  Bell,
  ChartNoAxesColumn,
  Hash,
  Mail,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { NotificationView } from "@/components/shell/notification-item";
import { matchesView } from "@/components/shell/activity/views";
import type { NotificationRow } from "@/lib/notifications/types";
import { Gi } from "./icon";

/**
 * Shared pieces of gr8r-studio's inbox + notifications pages
 * (src/pages/inbox.js `notifIcon` / `inboxItem`, src/core/utils.js `ago` /
 * `dayBucket`) over our `NotificationRow` + `notificationView` mapping.
 */

/** gr8r member colours are a fixed hue per person; ours are derived from the
 *  name so the same actor always reads the same colour. */
const AV_HUES = [
  "var(--g8-blue)",
  "var(--g8-violet)",
  "var(--g8-teal)",
  "var(--g8-rose)",
  "var(--g8-orange)",
  "var(--g8-green)",
  "var(--g8-amber)",
] as const;

function hueFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AV_HUES[Math.abs(h) % AV_HUES.length];
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Alerts (escalations, risks, failures) — gr8r's red system avatar. */
export function isAlert(n: NotificationRow): boolean {
  return matchesView(n, "alerts");
}

/** gr8r `notifIcon`: the actor's avatar, else a tinted system glyph. */
export function NotifAvatar({
  n,
  v,
}: {
  n: NotificationRow;
  v: NotificationView;
}) {
  if (v.actor) {
    return (
      <span
        className="av md"
        style={{ "--g8-c": hueFor(v.actor) } as CSSProperties}
        aria-label={v.actor}
        title={v.actor}
      >
        {initials(v.actor)}
      </span>
    );
  }
  return (
    <span
      className="av md"
      style={
        {
          "--g8-c": isAlert(n) ? "var(--g8-red)" : "var(--g8-amber)",
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {v.icon}
    </span>
  );
}

/** gr8r's per-type glyph in the row meta line (at-sign / user-plus / …). */
export function notifTypeIcon(n: NotificationRow): LucideIcon {
  if (matchesView(n, "mentions")) return AtSign;
  if (matchesView(n, "tasks")) return UserPlus;
  if (matchesView(n, "channels")) return Hash;
  if (matchesView(n, "alerts")) return TriangleAlert;
  if (matchesView(n, "reports")) return ChartNoAxesColumn;
  if (matchesView(n, "invites")) return Mail;
  return Bell;
}

export function NotifTypeGlyph({ n }: { n: NotificationRow }) {
  return <Gi icon={notifTypeIcon(n)} size={11} />;
}

/** gr8r `ago`: "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** gr8r `dayBucket`: Today / Yesterday / This week / Earlier. */
export function dayBucket(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const n = Math.round((d.getTime() - today.getTime()) / 864e5);
  if (n === 0) return "Today";
  if (n === -1) return "Yesterday";
  if (n > -7) return "This week";
  return "Earlier";
}

/** Persist a set of ids as read (the optimistic cache flip is the caller's). */
export function persistRead(ids: string[]) {
  if (ids.length === 0) return;
  void fetch("/api/me/notifications/mark-read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  }).catch(() => {});
}
