"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectTracking } from "@/lib/query/project-queries";
import type { ProjectStatus } from "@/lib/db/types";
import {
  COLOR_DOT,
  ContributorStack,
  PROJECT_STATUS_META,
  progressPct,
  type ProjectsViewProps,
} from "./tracking-shared";

const DAY_WIDTH = 36; // px per day
const ROW_HEIGHT = 44; // px per project row
const LABEL_WIDTH = 256; // px for the left label pane
const VISIBLE_WEEKS = 8; // default visible window
const VISIBLE_DAYS = VISIBLE_WEEKS * 7;
const MS_PER_DAY = 86_400_000;

/** Fill + text classes for a milestone diamond, keyed to project status. */
const DIAMOND_TONE: Record<ProjectStatus, string> = {
  planned: "fill-blue-500 text-blue-500",
  active: "fill-emerald-500 text-emerald-500",
  completed: "fill-violet-500 text-violet-500",
  archived: "fill-muted-foreground text-muted-foreground",
};

function startOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Monday of the week containing `d`. */
function startOfWeek(d: Date) {
  const out = startOfDay(d);
  const day = out.getDay();
  // ISO week: Monday = 1. JS getDay: Sun=0,Mon=1,...,Sat=6.
  const shift = (day + 6) % 7;
  out.setDate(out.getDate() - shift);
  return out;
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function diffDays(a: Date, b: Date) {
  return Math.round(
    (startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_PER_DAY,
  );
}

type Placed =
  | { project: ProjectTracking; kind: "bar"; startDay: number; endDay: number }
  | { project: ProjectTracking; kind: "milestone"; day: number };

/** Decide how a single project renders on the timeline given the visible window. */
function place(
  project: ProjectTracking,
  windowStart: Date,
  windowEnd: Date,
): Placed | null {
  const { start_date, target_date } = project;
  if (start_date && target_date) {
    const start = new Date(start_date);
    const end = new Date(target_date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    // Skip ranges that fall entirely outside the visible window.
    if (end < windowStart || start > windowEnd) return null;
    const clampedStart = start < windowStart ? windowStart : start;
    const clampedEnd = end > windowEnd ? windowEnd : end;
    return {
      project,
      kind: "bar",
      startDay: diffDays(clampedStart, windowStart),
      endDay: diffDays(clampedEnd, windowStart),
    };
  }
  const single = start_date ?? target_date;
  if (single) {
    const d = new Date(single);
    if (Number.isNaN(d.getTime())) return null;
    if (d < windowStart || d > windowEnd) return null;
    return { project, kind: "milestone", day: diffDays(d, windowStart) };
  }
  return null;
}

export function ProjectsTimelineView({
  propertyId,
  projects,
  members,
}: ProjectsViewProps) {
  // Offset (in weeks) from the current week. Current time is derived inside
  // handlers / render — never at module scope.
  const [weekOffset, setWeekOffset] = useState(0);

  const windowStart = useMemo(
    () => addDays(startOfWeek(new Date()), weekOffset * 7),
    [weekOffset],
  );
  const windowEnd = addDays(windowStart, VISIBLE_DAYS - 1);
  const today = startOfDay(new Date());
  const todayOffset = diffDays(today, windowStart);

  const days = useMemo(
    () =>
      Array.from({ length: VISIBLE_DAYS }, (_, i) => addDays(windowStart, i)),
    [windowStart],
  );

  const { placed, unscheduled } = useMemo(() => {
    const placedRows: Placed[] = [];
    const noDate: ProjectTracking[] = [];
    for (const p of projects) {
      const result = place(p, windowStart, windowEnd);
      if (result) placedRows.push(result);
      else if (!p.start_date && !p.target_date) noDate.push(p);
    }
    return { placed: placedRows, unscheduled: noDate };
  }, [projects, windowStart, windowEnd]);

  const anyDated = projects.some((p) => p.start_date || p.target_date);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Nav row */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setWeekOffset((w) => w - VISIBLE_WEEKS)}
            aria-label="Previous weeks"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setWeekOffset((w) => w + VISIBLE_WEEKS)}
            aria-label="Next weeks"
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setWeekOffset(0)}
          >
            Today
          </Button>
        </div>
        <h2 className="text-sm font-medium text-foreground">
          {windowStart.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}{" "}
          –{" "}
          {windowEnd.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="block h-1.5 w-4 rounded-full bg-emerald-500/70" />
            Range
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Diamond className="size-3 fill-muted-foreground text-muted-foreground" />
            Single date
          </span>
        </div>
      </div>

      {/* Body — left labels + right scrollable timeline */}
      <div className="flex min-h-0 flex-1 overflow-auto">
        {/* Left label column */}
        <div
          className="sticky left-0 z-20 shrink-0 border-r border-border bg-background/95 backdrop-blur"
          style={{ width: LABEL_WIDTH }}
        >
          {/* Header spacer to match the day-header row */}
          <div className="sticky top-0 z-10 h-12 border-b border-border bg-background/95" />
          {placed.length === 0 ? (
            <div
              className="flex items-center px-3 text-xs text-muted-foreground/70"
              style={{ height: ROW_HEIGHT }}
            >
              {anyDated ? "Nothing in this window" : "No dated projects"}
            </div>
          ) : (
            placed.map((row) => (
              <ProjectLabel
                key={row.project.id}
                project={row.project}
                members={members}
                propertyId={propertyId}
              />
            ))
          )}
        </div>

        {/* Right timeline */}
        <div
          className="relative shrink-0"
          style={{ width: VISIBLE_DAYS * DAY_WIDTH }}
        >
          {/* Day / week header */}
          <DayHeader days={days} todayOffset={todayOffset} />

          {/* Body grid + bars */}
          <div className="relative">
            {/* Background day grid */}
            <div
              className="absolute inset-0"
              aria-hidden
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px " +
                  DAY_WIDTH +
                  "px)",
                backgroundSize: `${DAY_WIDTH * 7}px 100%`,
                opacity: 0.3,
              }}
            />
            {/* Weekend tint */}
            {days.map((d, i) =>
              d.getDay() === 0 || d.getDay() === 6 ? (
                <div
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute top-0 bg-muted/40"
                  style={{
                    left: i * DAY_WIDTH,
                    width: DAY_WIDTH,
                    height: "100%",
                  }}
                />
              ) : null,
            )}
            {/* Today line */}
            {todayOffset >= 0 && todayOffset < VISIBLE_DAYS ? (
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 z-10 w-px bg-red-500/60"
                style={{
                  left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2,
                  height: "100%",
                }}
              />
            ) : null}

            {/* Rows */}
            {placed.length === 0 ? (
              <div
                className="flex items-center justify-center text-sm text-muted-foreground"
                style={{ height: ROW_HEIGHT * 3 }}
              >
                {anyDated
                  ? "No projects fall within this window."
                  : "No projects have dates yet."}
              </div>
            ) : (
              placed.map((row) => (
                <TimelineRow
                  key={row.project.id}
                  item={row}
                  propertyId={propertyId}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Unscheduled projects — no dates, plotted nowhere on the axis. */}
      {unscheduled.length > 0 ? (
        <div className="shrink-0 border-t border-border bg-muted/20 px-4 py-3">
          <p className="mb-2 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
            Unscheduled — {unscheduled.length}{" "}
            {unscheduled.length === 1 ? "project" : "projects"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map((p) => (
              <Link
                key={p.id}
                href={`/p/${propertyId}/projects/${p.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    COLOR_DOT[p.color],
                  )}
                  aria-hidden
                />
                <span className="max-w-40 truncate">
                  {p.name || "Untitled project"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DayHeader({
  days,
  todayOffset,
}: {
  days: Date[];
  todayOffset: number;
}) {
  // Group consecutive days under their month label.
  const months: { label: string; start: number; span: number }[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    const label = d.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const last = months[months.length - 1];
    if (last && last.label === label) last.span += 1;
    else months.push({ label, start: i, span: 1 });
  }

  return (
    <div className="sticky top-0 z-10 h-12 border-b border-border bg-background/95 backdrop-blur">
      <div className="relative h-5 border-b border-border/40">
        {months.map((m) => (
          <span
            key={m.start}
            className="absolute top-0 truncate px-2 text-xs font-semibold tracking-wide text-foreground"
            style={{
              left: m.start * DAY_WIDTH,
              width: m.span * DAY_WIDTH,
              lineHeight: "20px",
            }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="relative h-7">
        {days.map((d, i) => {
          const isToday = i === todayOffset;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div
              key={i}
              className={cn(
                "absolute top-0 flex h-7 flex-col items-center justify-center text-[10px]",
                isWeekend
                  ? "text-muted-foreground/60"
                  : "text-muted-foreground",
                isToday && "text-red-600 dark:text-red-400",
              )}
              style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
            >
              <span className="leading-none">
                {d.toLocaleDateString(undefined, { weekday: "narrow" })}
              </span>
              <span
                className={cn(
                  "mt-0.5 grid size-5 place-items-center rounded-full text-xs font-semibold tabular-nums",
                  isToday && "bg-red-500 text-white",
                )}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectLabel({
  project,
  members,
  propertyId,
}: {
  project: ProjectTracking;
  members: ProjectsViewProps["members"];
  propertyId: string;
}) {
  const pct = progressPct(project.done, project.total);
  const meta = PROJECT_STATUS_META[project.status];
  return (
    <Link
      href={`/p/${propertyId}/projects/${project.id}`}
      className="flex items-center gap-2.5 border-b border-border/40 px-3 transition-colors hover:bg-muted/40"
      style={{ height: ROW_HEIGHT }}
    >
      <span
        className={cn("size-2 shrink-0 rounded-full", COLOR_DOT[project.color])}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm text-foreground">
          {project.name || "Untitled project"}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums">
          <span className={meta.text}>{meta.label}</span>
          <span aria-hidden>·</span>
          <span>{pct}%</span>
        </span>
      </div>
      <ContributorStack
        ids={project.contributorIds}
        members={members}
        max={2}
        size="size-5"
      />
    </Link>
  );
}

function TimelineRow({
  item,
  propertyId,
}: {
  item: Placed;
  propertyId: string;
}) {
  const { project } = item;
  const meta = PROJECT_STATUS_META[project.status];
  const pct = progressPct(project.done, project.total);
  const href = `/p/${propertyId}/projects/${project.id}`;

  return (
    <div
      className="relative border-b border-border/40"
      style={{ height: ROW_HEIGHT }}
    >
      {item.kind === "bar" ? (
        (() => {
          const left = item.startDay * DAY_WIDTH + 2;
          const width = Math.max(
            (item.endDay - item.startDay + 1) * DAY_WIDTH - 4,
            DAY_WIDTH - 4,
          );
          return (
            <Link
              href={href}
              title={`${project.name || "Untitled project"} — ${meta.label} · ${pct}%`}
              className={cn(
                "group absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md shadow-sm ring-1 ring-inset ring-black/5 transition-all hover:ring-2 hover:ring-foreground/20",
                // Tinted track keyed to status.
                meta.soft,
              )}
              style={{
                left,
                width,
                height: ROW_HEIGHT - 16,
              }}
            >
              {/* Completion fill — darker, status-keyed. */}
              <span
                aria-hidden
                className={cn("absolute inset-y-0 left-0", meta.dot)}
                style={{ width: `${pct}%`, opacity: project.status === "archived" ? 0.4 : 0.85 }}
              />
              <span
                className={cn(
                  "relative z-10 truncate px-2 text-xs font-medium",
                  pct >= 55
                    ? "text-white"
                    : "text-foreground",
                )}
              >
                {width > 56
                  ? project.name || "Untitled project"
                  : `${pct}%`}
              </span>
            </Link>
          );
        })()
      ) : (
        <Link
          href={href}
          title={`${project.name || "Untitled project"} — ${meta.label}`}
          className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center hover:scale-110"
          style={{ left: item.day * DAY_WIDTH + DAY_WIDTH / 2 }}
          aria-label={`${project.name || "Untitled project"} date marker`}
        >
          <Diamond className={cn("size-4", DIAMOND_TONE[project.status])} />
        </Link>
      )}
    </div>
  );
}
