"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { ProjectTracking } from "@/lib/query/project-queries";
import {
  COLOR_DOT,
  ContributorStack,
  HEALTH_META,
  PROJECT_STATUS_META,
  ProgressBar,
  type ProjectsViewProps,
  progressPct,
  projectHealth,
  shortDate,
  STATUS_ORDER,
} from "./tracking-shared";

/* -------------------------------------------------------------------------- */
/* Table view — a dense, sortable list of projects (Linear "table layout").   */
/* Header row is sticky + clickable to sort; rows link through to the project.*/
/* -------------------------------------------------------------------------- */

type SortKey = "name" | "status" | "progress" | "target";
type SortDir = "asc" | "desc";
type Sort = { key: SortKey; dir: SortDir };

/** Default sort: by status order, then name. */
const DEFAULT_SORT: Sort = { key: "status", dir: "asc" };

function compareName(a: ProjectTracking, b: ProjectTracking): number {
  return (a.name || "").localeCompare(b.name || "", undefined, {
    sensitivity: "base",
  });
}

/** Comparator for the active sort key (asc); name is the stable tie-break. */
function compareBy(key: SortKey, a: ProjectTracking, b: ProjectTracking): number {
  switch (key) {
    case "name":
      return compareName(a, b);
    case "status": {
      const d = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return d !== 0 ? d : compareName(a, b);
    }
    case "progress": {
      const d = progressPct(a.done, a.total) - progressPct(b.done, b.total);
      return d !== 0 ? d : compareName(a, b);
    }
    case "target": {
      // Nulls / invalid dates always sort last, regardless of direction.
      const ta = a.target_date ? new Date(a.target_date).getTime() : NaN;
      const tb = b.target_date ? new Date(b.target_date).getTime() : NaN;
      const va = Number.isNaN(ta) ? Infinity : ta;
      const vb = Number.isNaN(tb) ? Infinity : tb;
      if (va === vb) return compareName(a, b);
      return va - vb;
    }
  }
}

const COLUMNS: {
  key: SortKey | null;
  label: string;
  /** Fixed column class (width / alignment). */
  className: string;
}[] = [
  { key: "name", label: "Project", className: "min-w-0 flex-1" },
  { key: "status", label: "Status", className: "w-28 shrink-0" },
  { key: null, label: "Health", className: "hidden w-28 shrink-0 lg:block" },
  { key: "progress", label: "Progress", className: "w-[200px] shrink-0" },
  { key: null, label: "Start", className: "hidden w-16 shrink-0 text-right xl:block" },
  { key: "target", label: "Target", className: "w-16 shrink-0 text-right" },
  { key: null, label: "Team", className: "hidden w-20 shrink-0 sm:block" },
];

export function ProjectsTableView({
  propertyId,
  projects,
  members,
}: ProjectsViewProps) {
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);

  const sorted = useMemo(() => {
    const copy = [...projects];
    copy.sort((a, b) => {
      const base = compareBy(sort.key, a, b);
      return sort.dir === "asc" ? base : -base;
    });
    return copy;
  }, [projects, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-2 sm:px-14">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/60 bg-background py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {COLUMNS.map((col, i) => {
          const active = col.key !== null && sort.key === col.key;
          const inner = (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                col.className.includes("text-right") && "flex-row-reverse",
              )}
            >
              {col.label}
              {active ? (
                sort.dir === "asc" ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )
              ) : null}
            </span>
          );
          return (
            <div key={`${col.label}-${i}`} className={col.className}>
              {col.key ? (
                <button
                  type="button"
                  onClick={() => toggleSort(col.key as SortKey)}
                  className={cn(
                    "inline-flex max-w-full items-center rounded transition-colors hover:text-foreground",
                    active && "text-foreground",
                  )}
                >
                  {inner}
                </button>
              ) : (
                inner
              )}
            </div>
          );
        })}
      </div>

      {/* Rows */}
      <ul role="list" className="divide-y divide-border/40">
        {sorted.map((p) => {
          const status = PROJECT_STATUS_META[p.status];
          const health = HEALTH_META[projectHealth(p)];
          const pct = progressPct(p.done, p.total);
          return (
            <li key={p.id} className="group/row">
              <Link
                href={`/p/${propertyId}/projects/${p.id}`}
                className="flex items-center gap-3 rounded-md py-2.5 text-sm tracking-tight transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                {/* Project */}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      COLOR_DOT[p.color],
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {p.name || "Untitled project"}
                  </span>
                </div>

                {/* Status */}
                <div className="w-28 shrink-0">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </div>

                {/* Health */}
                <div className="hidden w-28 shrink-0 lg:block">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs",
                      health.text,
                    )}
                  >
                    <span
                      className={cn("size-1.5 rounded-full", health.dot)}
                      aria-hidden="true"
                    />
                    {health.label}
                  </span>
                </div>

                {/* Progress */}
                <div className="flex w-[200px] shrink-0 items-center gap-2.5">
                  <ProgressBar
                    done={p.done}
                    total={p.total}
                    className="w-[140px] shrink-0"
                  />
                  <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">
                    {pct}%
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {p.done}/{p.total}
                  </span>
                </div>

                {/* Start */}
                <div className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground xl:block">
                  {shortDate(p.start_date)}
                </div>

                {/* Target */}
                <div className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {shortDate(p.target_date)}
                </div>

                {/* Team */}
                <div className="hidden w-20 shrink-0 sm:flex sm:justify-start">
                  <ContributorStack
                    ids={p.contributorIds}
                    members={members}
                    size="size-5"
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
