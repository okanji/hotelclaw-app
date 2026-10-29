"use client";

import type { CSSProperties } from "react";
import type { EntityColor, StatusCategory, TaskPriority } from "@/lib/db/types";
import { CATEGORY_META } from "@/lib/tasks/statuses";

/**
 * gr8r-studio's small render helpers (src/ui/helpers.js — `stIcon`,
 * `prIcon`, `dueHtml`) over OUR task model: a status row's category picks
 * the glyph (open → ring, unstarted → dashed ring, active → half, blocked →
 * three-quarter, done/closed → filled check) and its EntityColor the tint,
 * mapped onto the gr8r palette tokens. Shared by My Tasks and Favorites.
 */

/** EntityColor → gr8r palette token. */
export const G8_COLOR: Record<EntityColor, string> = {
  slate: "var(--g8-gray)",
  blue: "var(--g8-blue)",
  green: "var(--g8-green)",
  amber: "var(--g8-amber)",
  rose: "var(--g8-rose)",
  violet: "var(--g8-violet)",
};

export function g8Color(color: EntityColor | null | undefined): string {
  return (color && G8_COLOR[color]) || G8_COLOR.slate;
}

export function G8StatusIcon({
  category,
  blocked = false,
  color,
  size = 14,
}: {
  category: StatusCategory;
  blocked?: boolean;
  color?: EntityColor | null;
  size?: number;
}) {
  const c = g8Color(color ?? CATEGORY_META[category].color);
  const r = 5.4;
  let inner;
  if (category === "done" || category === "closed") {
    inner = (
      <>
        <circle cx="7" cy="7" r="6.2" fill={c} />
        <path
          d="M4.4 7.2 6.2 9 9.7 5.3"
          fill="none"
          stroke="var(--g8-surface)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    );
  } else if (category === "active") {
    inner = (
      <>
        <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />
        <path
          d={blocked ? "M7 3.4A3.6 3.6 0 1 1 3.4 7L7 7Z" : "M7 3.4A3.6 3.6 0 0 1 7 10.6Z"}
          fill={c}
        />
      </>
    );
  } else if (category === "unstarted") {
    inner = (
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke={c}
        strokeWidth="1.5"
        strokeDasharray="1.9 2.1"
      />
    );
  } else {
    inner = <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {inner}
    </svg>
  );
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export const PRIORITY_NAME: Record<TaskPriority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function G8PriorityIcon({
  priority,
  size = 14,
}: {
  priority: TaskPriority;
  size?: number;
}) {
  const svg = (children: React.ReactNode) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
  if (priority === "urgent")
    return svg(
      <>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--g8-red)" />
        <path d="M7 3.8v4" stroke="var(--g8-surface)" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r=".95" fill="var(--g8-surface)" />
      </>,
    );
  if (priority === "none")
    return svg(
      <path
        d="M2.5 7h2M6 7h2M9.5 7h2"
        stroke="var(--g8-text-3)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />,
    );
  const w = PRIORITY_WEIGHT[priority];
  const bar = (x: number, h: number, on: boolean) => (
    <rect
      x={x}
      y={12 - h}
      width="2.6"
      height={h}
      rx="1"
      fill={on ? "var(--g8-text-2)" : "var(--g8-border-strong)"}
    />
  );
  return svg(
    <>
      {bar(1.8, 4.5, w >= 1)}
      {bar(5.7, 7.5, w >= 2)}
      {bar(9.6, 10.5, w >= 3)}
    </>,
  );
}

const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date | number): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Whole local days from `today` (a start-of-day ms) to `iso`'s day. */
export function dayDiff(iso: string, today: number): number {
  return Math.round((startOfDay(new Date(iso)) - today) / DAY);
}

/** gr8r `relDate`: Today / Tomorrow / Yesterday / "Mar 4". */
export function relDate(iso: string, today: number): string {
  const n = dayDiff(iso, today);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date(today).getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** `--g8-c` custom property for the `.pdot` / `.av` / `.lbl` classes. */
export function cVar(c: string): CSSProperties {
  return { "--g8-c": c } as CSSProperties;
}
