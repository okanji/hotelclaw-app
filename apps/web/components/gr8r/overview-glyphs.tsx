"use client";

import type { CSSProperties, ReactNode } from "react";
import { FolderKanban } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { initialsOf, memberHue } from "@/components/gr8r/home-glyphs";
import { cVar, g8Color } from "@/components/gr8r/my-tasks-glyphs";
import type { EntityColor } from "@/lib/db/types";
import type { PaceFlag } from "@/lib/insights/metrics";
import {
  projectHealth,
  type ProjectHealth,
} from "@/components/projects/tracking/tracking-shared";
import type { ProjectTracking } from "@/lib/query/project-queries";

/**
 * Glyphs for the workspace Overview + Timeline pages. gr8r's `av`, `avStack`,
 * `progBar`, `pStatus`, `pIcon` (src/ui/helpers.js) — written against the
 * GENERATED class contract, where gr8r's `--c` / `--p` / `--sz` are
 * `--g8-c` / `--g8-p` / `--g8-sz` (home-glyphs.tsx still sets the bare names).
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export type OvMember = {
  id: string;
  name: string | null;
  avatarUrl?: string | null;
};

/** gr8r `.av` — initials on a tinted disc (photo when the member has one). */
export function OvAv({
  member,
  size = "sm",
}: {
  member: OvMember | null | undefined;
  size?: "" | "sm" | "md" | "lg";
}) {
  const cls = size ? `av ${size}` : "av";
  if (!member)
    return (
      <span className={`${cls} empty`} title="Unassigned" aria-label="Unassigned">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </span>
    );
  const name = member.name ?? "Someone";
  return (
    <span
      className={cls}
      style={{ ...cVar(memberHue(member.id)), overflow: "hidden" }}
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

/** gr8r `.prog` — a 4px bar, `tone` red/amber/green. */
export function OvProg({ value, tone = "" }: { value: number; tone?: string }) {
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
export function OvPStatus({
  name,
  color,
  tip,
}: {
  name: string;
  color: string;
  tip?: string;
}) {
  return (
    <span className="pstatus" style={cVar(color)} title={tip}>
      <i />
      {name}
    </span>
  );
}

/** gr8r `pIcon` — the project's emoji (or a folder) on its tinted tile. */
export function OvPIcon({
  color,
  icon,
  size = 22,
}: {
  color: EntityColor | null | undefined;
  icon?: string | null;
  size?: number;
}): ReactNode {
  return (
    <span
      className="picon"
      style={
        {
          ...cVar(g8Color(color)),
          "--g8-sz": `${size}px`,
          fontSize: Math.round(size * 0.55),
        } as CSSVars
      }
    >
      {icon ? icon : <Gi icon={FolderKanban} size={Math.round(size * 0.62)} />}
    </span>
  );
}

/**
 * gr8r's PSTAT over our project lifecycle + the deterministic pace read
 * (lib/insights/metrics `paceFor` — the Insights portfolio's number), falling
 * back to the client `projectHealth` when the metrics payload isn't available
 * (staff get the personal slice, not the portfolio).
 */
export function projectStatusOf(
  p: Pick<ProjectTracking, "status" | "target_date" | "done" | "total">,
  pace: PaceFlag | null,
  now: number,
): { name: string; c: string; tone: "" | "red" | "amber" | "green" } {
  if (p.status === "completed")
    return { name: "Completed", c: "var(--g8-green)", tone: "green" };
  if (p.status === "archived")
    return { name: "Archived", c: "var(--g8-gray)", tone: "" };
  if (p.status === "planned")
    return { name: "Planning", c: "var(--g8-gray)", tone: "" };
  let risk: "at_risk" | "behind" | null = null;
  if (pace) risk = pace === "on_pace" ? null : pace;
  else {
    const h: ProjectHealth = projectHealth(p, now);
    if (h === "overdue" || h === "at_risk") risk = "at_risk";
  }
  if (risk === "at_risk") return { name: "At Risk", c: "var(--g8-red)", tone: "red" };
  if (risk === "behind") return { name: "Behind", c: "var(--g8-amber)", tone: "amber" };
  return { name: "In Progress", c: "var(--g8-blue)", tone: "" };
}

export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00`)
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
