"use client";

import type { CSSProperties } from "react";
import type { EntityColor, TaskPriority } from "@/lib/db/types";
import type { StatusLike } from "@/lib/tasks/statuses";
import { isBlocked, isDone, isStarted } from "@/lib/tasks/statuses";

/**
 * gr8r's small glyph helpers (src/ui/helpers.js — `stIcon`, `prIcon`, `av`,
 * `avStack`, `progBar`, `pStatus`) as React, over OUR task / member shapes.
 * Colours are gr8r tokens (`--g8-*`), never hex.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

/** EntityColor → gr8r palette token. */
export const G8_COLOR: Record<EntityColor, string> = {
  slate: "var(--g8-gray)",
  blue: "var(--g8-blue)",
  green: "var(--g8-green)",
  amber: "var(--g8-amber)",
  rose: "var(--g8-rose)",
  violet: "var(--g8-violet)",
};

/** Members carry no colour of their own — derive a stable one from the id. */
const MEMBER_HUES = [
  "var(--g8-blue)",
  "var(--g8-violet)",
  "var(--g8-teal)",
  "var(--g8-rose)",
  "var(--g8-orange)",
  "var(--g8-green)",
  "var(--g8-amber)",
];
export function memberHue(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return MEMBER_HUES[Math.abs(h) % MEMBER_HUES.length]!;
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts
    .map((p) => p[0]!)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** gr8r task-status glyph, keyed off our status category. */
export function StIcon({ task, size = 14 }: { task: StatusLike; size?: number }) {
  const r = 5.4;
  let inner: React.ReactNode;
  if (isDone(task)) {
    inner = (
      <>
        <circle cx="7" cy="7" r="6.2" fill="var(--g8-st-done)" />
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
  } else if (isStarted(task)) {
    const c = isBlocked(task) ? "var(--g8-red)" : "var(--g8-st-progress)";
    inner = (
      <>
        <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />
        <path d="M7 3.4A3.6 3.6 0 0 1 7 10.6Z" fill={c} />
      </>
    );
  } else {
    inner = (
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="var(--g8-st-todo)"
        strokeWidth="1.5"
      />
    );
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

const PR_WEIGHT: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};
export const PR_NAME: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};
export function priorityWeight(p: TaskPriority | null | undefined): number {
  return PR_WEIGHT[p ?? "none"] ?? 0;
}

/** gr8r priority glyph: urgent tile, three signal bars, or a dashed "none". */
export function PrIcon({
  priority,
  size = 14,
}: {
  priority: TaskPriority | null | undefined;
  size?: number;
}) {
  const p = priority ?? "none";
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
  if (p === "urgent")
    return svg(
      <>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--g8-red)" />
        <path
          d="M7 3.8v4"
          stroke="var(--g8-on-accent)"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <circle cx="7" cy="10.1" r=".95" fill="var(--g8-on-accent)" />
      </>,
    );
  if (p === "none")
    return svg(
      <path
        d="M2.5 7h2M6 7h2M9.5 7h2"
        stroke="var(--g8-text-3)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />,
    );
  const w = PR_WEIGHT[p];
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

export type AvMember = {
  id: string;
  name: string | null;
  avatarUrl?: string | null;
};

/** gr8r `.av` — initials on a tinted disc (photo when the member has one). */
export function Av({
  member,
  size = "sm",
}: {
  member: AvMember | null | undefined;
  size?: "" | "sm" | "md" | "lg";
}) {
  const cls = size ? `av ${size}` : "av";
  if (!member)
    return (
      <span className={`${cls} empty`} title="Unassigned" aria-label="Unassigned">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </span>
    );
  const name = member.name ?? "Someone";
  return (
    <span
      className={cls}
      style={{ "--g8-c": memberHue(member.id), overflow: "hidden" } as CSSVars}
      title={name}
      aria-label={name}
    >
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.avatarUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

/** gr8r `.avs` — overlapping avatars with a "+N" chip past `max`. */
export function AvStack({
  members,
  max = 4,
}: {
  members: AvMember[];
  max?: number;
}) {
  const shown = members.slice(0, max);
  return (
    <span className="avs">
      {shown.map((m) => (
        <Av key={m.id} member={m} />
      ))}
      {members.length > max ? (
        <span className="av sm more" style={{ "--g8-c": "var(--g8-gray)" } as CSSVars}>
          +{members.length - max}
        </span>
      ) : null}
    </span>
  );
}

/** gr8r `.prog` — a 4px bar, `tone` red/amber/green. */
export function ProgBar({ value, tone = "" }: { value: number; tone?: string }) {
  return (
    <span
      className={tone ? `prog ${tone}` : "prog"}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ "--g8-p": value / 100 } as CSSVars} />
    </span>
  );
}

/** gr8r `.pstatus` — a bordered pill with a colour dot. */
export function PStatus({ name, color }: { name: string; color: string }) {
  return (
    <span className="pstatus" style={{ "--g8-c": color } as CSSVars}>
      <i />
      {name}
    </span>
  );
}
