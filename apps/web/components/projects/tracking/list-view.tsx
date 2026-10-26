"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, CalendarDays, ChevronRight, Diamond, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COLOR_DOT,
  ContributorStack,
  type ProjectsViewProps,
  progressPct,
} from "./tracking-shared";
import {
  HEALTH_LABEL,
  HEALTH_TEXT,
  HealthIcon,
  type ListProperty,
  type ProjectsOrdering,
  ProjectRowMenu,
  StatusIcon,
  ageShort,
  effectiveHealth,
  nextMilestone,
  useProjectsDisplay,
} from "./project-display";

/* -------------------------------------------------------------------------- */
/* List — Linear's Projects list layout: a quiet column header (Name, Target */
/* and Status sort), tinted groups with a count + "+", and rows of Name ·    */
/* next milestone · Health ("On track · 5w") · Lead · Target date · Tasks ·  */
/* Status %. Which columns show is a display property.                       */
/* -------------------------------------------------------------------------- */

const COLS: {
  id: ListProperty | "menu";
  label: string;
  className: string;
  sort?: ProjectsOrdering;
}[] = [
  { id: "health", label: "Health", className: "w-36" },
  { id: "menu", label: "", className: "w-8" },
  { id: "lead", label: "Lead", className: "hidden w-36 md:block" },
  { id: "target", label: "Target date", className: "w-32", sort: "target" },
  { id: "issues", label: "Tasks", className: "hidden w-14 text-right sm:block" },
  { id: "status", label: "Status", className: "w-20", sort: "progress" },
];

function longDate(value: string | null) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function ProjectsListView({
  propertyId,
  members,
  groups = [],
  declared,
  milestonesByProject,
  onChanged,
  onCreate,
}: ProjectsViewProps) {
  const { display, update } = useProjectsDisplay();
  const shown = new Set<string>([...display.properties, "menu"]);
  const cols = COLS.filter((c) => shown.has(c.id));
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  function toggleGroup(key: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="h-full overflow-y-auto px-[calc(var(--page-gutter)-0.5rem)] pb-8">
      {/* Column header — quiet, Linear's. */}
      <div className="sticky top-0 z-10 flex h-9 items-center gap-3 bg-card px-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => update({ ordering: "name" })}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 pl-5 hover:text-foreground",
            display.ordering === "name" && "text-foreground",
          )}
        >
          Name
          {display.ordering === "name" ? <ArrowDown className="size-3" /> : null}
        </button>
        {cols.map((c) => (
          <div key={c.id} className={cn("shrink-0", c.className)}>
            {c.sort ? (
              <button
                type="button"
                onClick={() => update({ ordering: c.sort })}
                className={cn(
                  "inline-flex items-center gap-1 hover:text-foreground",
                  display.ordering === c.sort && "text-foreground",
                )}
              >
                {c.label}
                {display.ordering === c.sort ? <ArrowDown className="size-3" /> : null}
              </button>
            ) : (
              c.label
            )}
          </div>
        ))}
      </div>

      {groups.map((g) => {
        const open = !folded.has(g.key);
        return (
          <section key={g.key} className="mb-1">
            <div className={cn("flex h-9 items-center rounded-md pr-1", g.tint)}>
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                aria-expanded={open}
                className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-sm"
              >
                <ChevronRight
                  className={cn(
                    "size-3 shrink-0 text-faint-foreground transition-transform",
                    open && "rotate-90",
                  )}
                />
                {g.icon}
                <span className="truncate font-medium text-foreground">{g.label}</span>
                <span className="text-muted-foreground tabular-nums">{g.rows.length}</span>
              </button>
              <button
                type="button"
                onClick={onCreate}
                aria-label="New project"
                title="New project"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-4" />
              </button>
            </div>

            {open ? (
              <ul role="list">
                {g.rows.map((p) => {
                  const href = `/p/${propertyId}/projects/${p.id}`;
                  const { health, at } = effectiveHealth(p, declared);
                  const pct = progressPct(p.done, p.total);
                  const next = nextMilestone(milestonesByProject?.get(p.id));
                  const target = longDate(p.target_date);
                  const lead = p.lead_user_id
                    ? members.find((m) => m.id === p.lead_user_id)
                    : undefined;
                  const age = ageShort(at);
                  return (
                    <li key={p.id} className="relative">
                      {/* Whole-row link under the cells; the menu sits above it. */}
                      <Link
                        href={href}
                        aria-label={p.name || "Untitled project"}
                        className="absolute inset-0 rounded-md transition-colors hover:bg-accent"
                      />
                      <div className="pointer-events-none relative flex h-11 items-center gap-3 px-2 text-sm">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-5">
                          {p.icon ? (
                            <span aria-hidden="true" className="w-4 shrink-0 text-center">
                              {p.icon}
                            </span>
                          ) : (
                            <span
                              aria-hidden="true"
                              className={cn("size-3 shrink-0 rounded-[4px]", COLOR_DOT[p.color])}
                            />
                          )}
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {p.name || "Untitled project"}
                          </span>
                          {shown.has("milestone") && next ? (
                            <span className="hidden min-w-0 shrink items-center gap-1 text-xs text-muted-foreground lg:inline-flex">
                              <Diamond className="size-3 shrink-0 text-warning" />
                              <span className="truncate">{next.name}</span>
                            </span>
                          ) : null}
                        </div>
                        {cols.map((c) => {
                          switch (c.id) {
                            case "health":
                              return (
                                <div
                                  key={c.id}
                                  className={cn(
                                    "flex shrink-0 items-center gap-1.5 text-xs",
                                    c.className,
                                    HEALTH_TEXT[health],
                                  )}
                                >
                                  <HealthIcon health={health} />
                                  <span className="truncate">
                                    {HEALTH_LABEL[health]}
                                    {age ? (
                                      <span className="text-faint-foreground"> · {age}</span>
                                    ) : null}
                                  </span>
                                </div>
                              );
                            case "menu":
                              return (
                                <div key={c.id} className={cn("pointer-events-auto shrink-0", c.className)}>
                                  <ProjectRowMenu project={p} href={href} onChanged={onChanged} />
                                </div>
                              );
                            case "lead":
                              return (
                                <div key={c.id} className={cn("shrink-0", c.className)}>
                                  {lead ? (
                                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
                                      <ContributorStack ids={[lead.id]} members={members} size="size-5" />
                                      <span className="truncate">{lead.name ?? "Member"}</span>
                                    </span>
                                  ) : null}
                                </div>
                              );
                            case "target":
                              return (
                                <div
                                  key={c.id}
                                  className={cn(
                                    "flex shrink-0 items-center gap-1.5 text-xs text-foreground tabular-nums",
                                    c.className,
                                  )}
                                >
                                  {target ? (
                                    <>
                                      <CalendarDays className="size-3.5 text-faint-foreground" />
                                      {target}
                                    </>
                                  ) : null}
                                </div>
                              );
                            case "issues":
                              return (
                                <div
                                  key={c.id}
                                  className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", c.className)}
                                >
                                  {p.total}
                                </div>
                              );
                            case "status":
                              return (
                                <div
                                  key={c.id}
                                  className={cn(
                                    "flex shrink-0 items-center gap-1.5 text-xs text-foreground tabular-nums",
                                    c.className,
                                  )}
                                >
                                  <StatusIcon status={p.status} pct={pct} />
                                  {pct}%
                                </div>
                              );
                            default:
                              return null;
                          }
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
