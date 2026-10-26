"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, Diamond, Plus, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectTracking } from "@/lib/query/project-queries";
import type { PropertyMilestone } from "@/lib/query/milestone-queries";
import { updateProject } from "../actions";
import {
  COLOR_DOT,
  ContributorStack,
  type ProjectsViewProps,
  progressPct,
} from "./tracking-shared";
import {
  HealthIcon,
  OptionMenu,
  ProjectRowMenu,
  StatusIcon,
  type TimelineZoom,
  effectiveHealth,
  nextMilestone,
  useProjectsDisplay,
} from "./project-display";

/* -------------------------------------------------------------------------- */
/* Timeline — Linear's Projects page (its default layout). One canvas: the   */
/* date header and every row's track run the full width, and the project    */
/* list is a sticky column laid OVER the canvas's left edge. Groups are      */
/* tinted bars with a count and a "+"; each bar carries its name above, the */
/* next milestone + progress at its end, and milestone diamonds on it.       */
/* Undated projects schedule in one click (a four-week ghost bar).           */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;
const LEFT = 268;
const ROW_H = 50;
const GHOST_DAYS = 28;
const ZOOM_PX: Record<TimelineZoom, number> = { month: 24, quarter: 8, year: 3 };
const ZOOM_OPTIONS: { id: TimelineZoom; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** `date` columns arrive as "YYYY-MM-DD" — parse as LOCAL days (`new Date`
 *  reads them as UTC midnight and shifts a day west of Greenwich). */
function parseDay(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function toDay(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function diffDays(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY_MS);
}

export function ProjectsTimelineView({
  propertyId,
  projects,
  members,
  groups = [],
  declared,
  milestonesByProject,
  onChanged,
  onCreate,
}: ProjectsViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const { display, update } = useProjectsDisplay();
  const px = ZOOM_PX[display.zoom];

  // Window: two months back to a year ahead, widened to every dated project.
  const [today] = useState(() => startOfDay(new Date()));
  const { origin, days, monthXs } = useMemo(() => {
    let lo = addDays(today, -60);
    let hi = addDays(today, 365);
    for (const p of projects) {
      for (const d of [parseDay(p.start_date), parseDay(p.target_date)]) {
        if (!d) continue;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
    const first = new Date(lo.getFullYear(), lo.getMonth(), 1);
    const last = new Date(hi.getFullYear(), hi.getMonth() + 2, 0);
    const n = diffDays(last, first) + 1;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) if (addDays(first, i).getDate() === 1) xs.push(i);
    return { origin: first, days: n, monthXs: xs };
  }, [projects, today]);
  const width = days * px;
  const todayX = diffDays(today, origin) * px;

  function scrollToToday(behavior: ScrollBehavior = "smooth") {
    const el = scroller.current;
    if (!el) return;
    const visible = el.clientWidth - LEFT;
    el.scrollTo({ left: Math.max(0, todayX - LEFT - visible / 3), behavior });
  }
  useEffect(() => {
    scrollToToday("instant");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.zoom, origin]);

  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  function toggleGroup(key: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function schedule(p: ProjectTracking, start: Date) {
    const res = await updateProject(p.id, {
      start_date: toDay(start),
      target_date: toDay(addDays(start, GHOST_DAYS - 1)),
    });
    if ("error" in res) toast.error(res.error);
    else onChanged();
  }

  const grid = (
    <>
      {monthXs.map((d) => (
        <span
          key={d}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-border/70"
          style={{ left: d * px }}
        />
      ))}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-px bg-primary/60"
        style={{ left: todayX + px / 2 }}
      />
    </>
  );

  return (
    <div ref={scroller} className="relative h-full overflow-auto">
      <div className="relative" style={{ width }}>
        {/* Date header — ticks run the full canvas (under the list column,
            like Linear's); Today + zoom float at the right edge. */}
        <div className="sticky top-0 z-30 flex h-11 justify-end bg-card">
          <TimeHeader origin={origin} days={days} px={px} zoom={display.zoom} todayX={todayX} today={today} />
          <div className="sticky right-0 z-10 flex shrink-0 items-center gap-1 bg-card pr-(--page-gutter) pl-2">
            <button
              type="button"
              onClick={() => scrollToToday()}
              className="h-7 rounded-md bg-muted px-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              Today
            </button>
            <OptionMenu
              label="Zoom"
              value={display.zoom}
              options={ZOOM_OPTIONS}
              onChange={(zoom) => update({ zoom })}
            />
          </div>
        </div>

        {groups.map((g) => {
          const open = !folded.has(g.key);
          return (
            <section key={g.key}>
              <div className={cn("relative flex h-9 items-center", g.tint)} style={{ width }}>
                {grid}
                <div
                  className="sticky left-0 z-10 flex min-w-0 items-center gap-2 pl-[calc(var(--page-gutter)-0.5rem)]"
                  style={{ width: LEFT + 200 }}
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.key)}
                    aria-expanded={open}
                    className="flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
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
                </div>
                <button
                  type="button"
                  onClick={onCreate}
                  aria-label="New project"
                  title="New project"
                  className="sticky right-[calc(var(--page-gutter)-0.5rem)] z-10 mr-[calc(var(--page-gutter)-0.5rem)] ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-4" />
                </button>
              </div>

              {open
                ? g.rows.map((p) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      propertyId={propertyId}
                      members={members}
                      health={effectiveHealth(p, declared).health}
                      milestones={milestonesByProject?.get(p.id) ?? []}
                      origin={origin}
                      px={px}
                      width={width}
                      grid={grid}
                      onChanged={onChanged}
                      onSchedule={(d) => void schedule(p, d)}
                    />
                  ))
                : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TimeHeader({
  origin,
  days,
  px,
  zoom,
  todayX,
  today,
}: {
  origin: Date;
  days: number;
  px: number;
  zoom: TimelineZoom;
  todayX: number;
  today: Date;
}) {
  const ticks = useMemo(() => {
    const months: { x: number; label: string }[] = [];
    const dates: { x: number; label: string }[] = [];
    // Date ticks: daily (month zoom), Mondays (quarter), the 1st + 15th (year).
    for (let i = 0; i < days; i++) {
      const d = addDays(origin, i);
      if (d.getDate() === 1) {
        const mon = d.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
        months.push({ x: i * px, label: d.getMonth() === 0 ? `${mon} ${d.getFullYear()}` : mon });
      }
      const show =
        zoom === "month" ? true : zoom === "quarter" ? d.getDay() === 1 : d.getDate() === 1 || d.getDate() === 15;
      if (show) dates.push({ x: i * px, label: String(d.getDate()) });
    }
    return { months, dates };
  }, [origin, days, px, zoom]);

  return (
    <div className="absolute inset-0 select-none" style={{ width: days * px }}>
      {ticks.months.map((m) => (
        <span
          key={m.x}
          className="absolute top-1.5 -translate-x-1/2 text-xs font-medium whitespace-nowrap text-muted-foreground"
          style={{ left: m.x + px / 2 }}
        >
          {m.label}
        </span>
      ))}
      {ticks.dates.map((d) => (
        <span
          key={d.x}
          className="absolute top-[22px] -translate-x-1/2 text-xs text-faint-foreground tabular-nums"
          style={{ left: d.x + px / 2 }}
        >
          {d.label}
        </span>
      ))}
      <span
        className="absolute top-[20px] z-10 -translate-x-1/2 rounded-md bg-primary px-1.5 py-px text-xs font-medium whitespace-nowrap text-primary-foreground"
        style={{ left: todayX + px / 2 }}
      >
        {today.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}
      </span>
    </div>
  );
}

function ProjectRow({
  project: p,
  propertyId,
  members,
  health,
  milestones,
  origin,
  px,
  width,
  grid,
  onChanged,
  onSchedule,
}: {
  project: ProjectTracking;
  propertyId: string;
  members: ProjectsViewProps["members"];
  health: ReturnType<typeof effectiveHealth>["health"];
  milestones: PropertyMilestone[];
  origin: Date;
  px: number;
  width: number;
  grid: React.ReactNode;
  onChanged: () => void;
  onSchedule: (start: Date) => void;
}) {
  const href = `/p/${propertyId}/projects/${p.id}`;
  const start = parseDay(p.start_date);
  const target = parseDay(p.target_date);
  const pct = progressPct(p.done, p.total);
  const next = nextMilestone(milestones);
  const [ghost, setGhost] = useState<number | null>(null);

  // A lone date is a one-week stub ending / starting there, so it still
  // reads as a bar rather than vanishing.
  let bar: { x: number; w: number } | null = null;
  if (start || target) {
    const s = start ?? addDays(target!, -6);
    const e = target ?? addDays(start!, 6);
    const lo = s <= e ? s : e;
    const hi = s <= e ? e : s;
    bar = { x: diffDays(lo, origin) * px, w: Math.max((diffDays(hi, lo) + 1) * px, 8) };
  }
  function dayAt(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.floor((e.clientX - rect.left) / px));
  }

  return (
    <div className="group/row relative flex" style={{ width, height: ROW_H }}>
      {/* Track: the whole row width, BEHIND the sticky list column. */}
      <div
        className={cn("absolute inset-0", !bar && "cursor-copy")}
        onMouseMove={bar ? undefined : (e) => setGhost(dayAt(e))}
        onMouseLeave={bar ? undefined : () => setGhost(null)}
        onClick={bar ? undefined : (e) => onSchedule(addDays(origin, dayAt(e)))}
      >
        {grid}
        {bar ? (
          <>
            <div
              className="pointer-events-none absolute top-1.5 flex items-baseline gap-3 whitespace-nowrap"
              style={{ left: bar.x, minWidth: bar.w }}
            >
              <span className="text-sm font-medium text-foreground">{p.name || "Untitled project"}</span>
              <span className="ml-auto text-xs text-faint-foreground tabular-nums">
                {next ? `${next.name} · ` : ""}
                {pct}%
              </span>
            </div>
            <Link
              href={href}
              title={`${p.name} · ${pct}% done`}
              className="absolute top-[26px] h-[18px] overflow-hidden rounded-[5px] border border-border bg-muted transition-colors hover:border-foreground/25"
              style={{ left: bar.x, width: bar.w }}
            >
              <span
                className={cn("block h-full opacity-40", COLOR_DOT[p.color])}
                style={{ width: `${pct}%` }}
              />
            </Link>
          </>
        ) : ghost !== null ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-[26px] h-[18px] rounded-[5px] border border-dashed border-foreground/25 bg-muted/50"
            style={{ left: ghost * px, width: GHOST_DAYS * px }}
          >
            <span className="absolute -top-5 left-0 text-xs whitespace-nowrap text-muted-foreground">
              Click to schedule
            </span>
          </span>
        ) : null}
        {milestones.map((m) => {
          const due = parseDay(m.due_date);
          if (!due) return null;
          return (
            <Diamond
              key={m.id}
              aria-label={m.name}
              className={cn(
                "absolute top-[29px] size-3 -translate-x-1/2",
                m.completed_at ? "fill-success text-success" : "fill-card text-foreground",
              )}
              style={{ left: diffDays(due, origin) * px + px / 2 }}
            >
              <title>{m.name}</title>
            </Diamond>
          );
        })}
      </div>

      {/* List column — sticky over the canvas, Linear's compact row. */}
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-card pr-3 pl-(--page-gutter) before:absolute before:inset-0 before:-z-10 before:bg-accent before:opacity-0 before:transition-opacity group-hover/row:before:opacity-100"
        style={{ width: LEFT }}
      >
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
          {p.icon ? (
            <span aria-hidden="true" className="w-4 shrink-0 text-center">
              {p.icon}
            </span>
          ) : (
            <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-[4px]", COLOR_DOT[p.color])} />
          )}
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {p.name || "Untitled project"}
          </span>
        </Link>
        <HealthIcon health={health} />
        <StatusIcon status={p.status} pct={pct} />
        <ProjectRowMenu project={p} href={href} onChanged={onChanged} />
        {p.lead_user_id ? (
          <ContributorStack ids={[p.lead_user_id]} members={members} size="size-5" />
        ) : (
          <span title="No lead" className="flex size-5 shrink-0 items-center justify-center text-faint-foreground">
            <UserRound className="size-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}
