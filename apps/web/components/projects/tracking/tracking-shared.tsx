"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ProjectTracking } from "@/lib/query/project-queries";
import type { EntityColor, ProjectStatus } from "@/lib/db/types";
import { LABEL_DOT } from "@/components/labels/label-tokens";

/* -------------------------------------------------------------------------- */
/* Shared contract for the projects tracking views                            */
/*                                                                            */
/* The container (`projects-index.tsx`) owns data fetching; each view         */
/* (board / table / timeline) is presentational + handles its own            */
/* interactions, mutating through the project server actions and calling      */
/* `onChanged()` to refresh. All three import the meta + helpers below so      */
/* status colours, ordering, and progress maths never drift between views.    */
/* -------------------------------------------------------------------------- */

export type ProjectMember = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type ProjectsViewMode = "board" | "table" | "timeline";

export type ProjectTeam = { id: string; name: string; color: EntityColor };

export type ProjectsViewProps = {
  propertyId: string;
  projects: ProjectTracking[];
  members: ProjectMember[];
  /** Teams (spaces) involved per project id — renders as chips on rows/cards. */
  teamsByProject?: Map<string, ProjectTeam[]>;
  /** Invalidate the tracking + projects queries after a mutation. */
  onChanged: () => void;
};

/** Compact "teams involved" chips (first two + overflow count). */
export function TeamChips({ teams }: { teams: ProjectTeam[] | undefined }) {
  if (!teams || teams.length === 0) return null;
  const shown = teams.slice(0, 2);
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.map((t) => (
        <span
          key={t.id}
          className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border/50 px-1.5 py-px text-[11px] tracking-tight text-muted-foreground"
        >
          <span
            className={cn("size-1.5 shrink-0 rounded-full", COLOR_DOT[t.color])}
            aria-hidden="true"
          />
          <span className="truncate">{t.name}</span>
        </span>
      ))}
      {teams.length > shown.length ? (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          +{teams.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

/** Status order used by the board columns and as the default sort. */
export const STATUS_ORDER: ProjectStatus[] = [
  "planned",
  "active",
  "completed",
  "archived",
];

/** StatusBadge tone per project status — the house status→tone map pattern. */
export type ProjectStatusTone = "neutral" | "success" | "info" | "violet";

export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  {
    label: string;
    dot: string;
    text: string;
    soft: string;
    tone: ProjectStatusTone;
  }
> = {
  planned: {
    label: "Planned",
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    soft: "bg-blue-500/10",
    tone: "info",
  },
  active: {
    label: "Active",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-500/10",
    tone: "success",
  },
  completed: {
    label: "Completed",
    dot: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    soft: "bg-violet-500/10",
    tone: "violet",
  },
  archived: {
    label: "Archived",
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    soft: "bg-muted",
    tone: "neutral",
  },
};

/** Accent dot for an `EntityColor` (project colour). */
export const COLOR_DOT = LABEL_DOT;

export function progressPct(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

export type ProjectHealth = "none" | "on_track" | "at_risk" | "overdue" | "done";

export const HEALTH_META: Record<
  ProjectHealth,
  { label: string; dot: string; text: string }
> = {
  none: { label: "No date", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
  on_track: { label: "On track", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  at_risk: { label: "At risk", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  overdue: { label: "Overdue", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  done: { label: "Done", dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
};

/**
 * A lightweight health read for a project: completed projects are `done`;
 * past the target date with open work is `overdue`; within ~7 days of target
 * but under 80% complete is `at_risk`; otherwise `on_track`. No target date →
 * `none`. Pure + deterministic so the board/table/timeline agree.
 */
export function projectHealth(
  p: Pick<ProjectTracking, "status" | "target_date" | "done" | "total">,
  now: number = Date.now(),
): ProjectHealth {
  if (p.status === "completed") return "done";
  if (!p.target_date) return "none";
  const target = new Date(p.target_date).getTime();
  if (Number.isNaN(target)) return "none";
  const pct = progressPct(p.done, p.total);
  const remainingMs = target - now;
  const DAY = 86_400_000;
  if (remainingMs < 0 && pct < 100) return "overdue";
  if (remainingMs < 7 * DAY && pct < 80) return "at_risk";
  return "on_track";
}

/** Short, compact date label (e.g. "Jun 8") or an em-dash. */
export function shortDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Overlapping avatar stack for a project's contributors. */
export function ContributorStack({
  ids,
  members,
  max = 4,
  size = "size-6",
}: {
  ids: string[];
  members: ProjectMember[];
  max?: number;
  size?: string;
}) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const people = ids.map((id) => byId.get(id)).filter((m): m is ProjectMember => !!m);
  if (people.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((p) => (
          <Avatar
            key={p.id}
            className={cn(size, "ring-2 ring-background")}
            title={p.name ?? undefined}
          >
            {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-[0.5625rem]">
              {initials(p.name)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {extra > 0 ? (
        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

/** Thin completion bar shared by the card + table rows. */
export function ProgressBar({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const pct = progressPct(done, total);
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      {total > 0 ? (
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      ) : null}
    </div>
  );
}
