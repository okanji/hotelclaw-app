"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, IterationCcw, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { G8_COLOR } from "@/components/gr8r/home-glyphs";
import { G8Stats } from "@/components/insights/g8-insights";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { spacesQueryOptions } from "@/lib/query/project-queries";
import { cyclesHref } from "@/lib/query/cycle-queries";
import {
  buildBurnups,
  type BurnupResult,
  type HistoryEvent,
} from "@/lib/cycles/burnup";
import { diffDays, formatRange, type DateStr } from "@/lib/cycles/dates";
import { cycleLabel, cyclePhase } from "@/lib/cycles/plan";
import { capacity, pct, successPct } from "@/lib/cycles/scope";
import type { CycleRow, CycleSettingsRow, CycleTask } from "@/lib/cycles/types";
import type { EntityColor } from "@/lib/db/types";
import { BurnupChart, BurnupLegend } from "./burnup-chart";
import { CycleSettingsForm } from "./cycle-settings-form";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The cycles list for one cadence (a team, or property-wide) — Linear's
 * vertical timeline: upcoming cycles on top, the current one expanded with
 * its burn-up and capacity, then finished cycles with their % success.
 *
 * Everything numeric is derived client-side from one server load (tasks +
 * activity_log) via the pure replay in lib/cycles/burnup — nothing is stored.
 */
export function CyclesView({
  propertyId,
  spaceId,
  settings,
  allSettings,
  cycles,
  tasks,
  events,
  today,
  timeZone,
}: {
  propertyId: string;
  spaceId: string | null;
  settings: CycleSettingsRow | null;
  allSettings: CycleSettingsRow[];
  cycles: CycleRow[];
  tasks: CycleTask[];
  events: HistoryEvent[];
  today: DateStr;
  timeZone: string;
}) {
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const space = spaceId ? spaces.find((s) => s.id === spaceId) : null;
  const scopeName = spaceId ? (space?.name ?? "Team") : "Whole property";
  const enabled = !!settings?.enabled;

  const burnups = useMemo(
    () => buildBurnups({ cycles, today, timeZone, tasks, events }),
    [cycles, today, timeZone, tasks, events],
  );

  const upcoming = cycles
    .filter((c) => cyclePhase(c, today) === "upcoming")
    .sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1));
  const current = cycles.find((c) => cyclePhase(c, today) === "current") ?? null;
  const past = cycles
    .filter((c) => cyclePhase(c, today) === "past")
    .sort((a, b) => (a.ends_on < b.ends_on ? 1 : -1));
  const recentCompleted = past.map((c) => burnups.get(c.id)?.stats.completed ?? 0);
  const refYear = Number(today.slice(0, 4));

  const cadence =
    enabled && settings
      ? `${settings.duration_weeks === 1 ? "Weekly" : `${settings.duration_weeks}-week`} cycles · start ${WEEKDAY[settings.start_weekday]}${settings.auto_rollover ? " · open work rolls over" : ""}`
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title="Cycles" icon={<IterationCcw />} meta={cadence} />
      <div className="flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 1000 }}>
          <div className="ph">
            <div>
              <h1>Cycles · {scopeName}</h1>
              <p>
                {cadence ??
                  "Plan the work in short, repeating windows that roll forward on their own."}
              </p>
            </div>
            <div className="acts">
              <ScopePicker
                propertyId={propertyId}
                spaceId={spaceId}
                scopeName={scopeName}
                allSettings={allSettings}
                spaces={spaces}
              />
              {enabled ? (
                <SettingsPopover
                  propertyId={propertyId}
                  spaceId={spaceId}
                  settings={settings}
                />
              ) : null}
            </div>
          </div>
          {!enabled ? (
            <div className="panel">
              <div className="empty-state">
                <div className="glyph">
                  <Gi icon={IterationCcw} size={22} />
                </div>
                <h2 className="es-h">Enable cycles for {scopeName}</h2>
                <p>
                  Plan the work in short, repeating windows. Cycles roll
                  forward on their own: the next one is created when this one
                  ends, and anything unfinished moves with it.
                </p>
                <div className="panel" style={{ width: 320, maxWidth: "100%", padding: 16, textAlign: "left" }}>
                  <CycleSettingsForm
                    propertyId={propertyId}
                    spaceId={spaceId}
                    settings={settings}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="stack">
              {current ? (
                <CurrentCycleCard
                  propertyId={propertyId}
                  cycle={current}
                  today={today}
                  refYear={refYear}
                  burnup={burnups.get(current.id)!}
                  capacityPct={
                    capacity(
                      burnups.get(current.id)?.stats.scope ?? 0,
                      recentCompleted,
                    ).pct
                  }
                />
              ) : null}

              {upcoming.length > 0 ? (
                <TimelineGroup label="Upcoming" count={upcoming.length}>
                  {upcoming.map((c) => {
                    const stats = burnups.get(c.id)?.stats;
                    return (
                      <CycleRowLink
                        key={c.id}
                        propertyId={propertyId}
                        cycle={c}
                        refYear={refYear}
                        tone="upcoming"
                        meta={`Starts in ${diffDays(today, c.starts_on)}d`}
                        stats={[
                          `${stats?.count ?? 0} ${stats?.count === 1 ? "task" : "tasks"}`,
                          `${stats?.scope ?? 0} scope`,
                        ]}
                      />
                    );
                  })}
                </TimelineGroup>
              ) : null}

              {past.length > 0 ? (
                <TimelineGroup label="Completed" count={past.length}>
                  {past.map((c) => {
                    const stats = burnups.get(c.id)!.stats;
                    return (
                      <CycleRowLink
                        key={c.id}
                        propertyId={propertyId}
                        cycle={c}
                        refYear={refYear}
                        tone="past"
                        success={successPct(stats)}
                        stats={[
                          `${stats.completedCount} completed`,
                          `${stats.scope} scope`,
                        ]}
                      />
                    );
                  })}
                </TimelineGroup>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>{label}</h2>
        <span className="faint num" style={{ fontSize: "var(--g8-fs-xs)" }}>
          {count}
        </span>
      </div>
      <ol role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {children}
      </ol>
    </section>
  );
}

function CycleRowLink({
  propertyId,
  cycle,
  refYear,
  tone,
  meta,
  success,
  stats,
}: {
  propertyId: string;
  cycle: CycleRow;
  refYear: number;
  tone: "upcoming" | "past";
  meta?: string;
  /** Finished cycles: % of scope completed. */
  success?: number;
  stats: string[];
}) {
  return (
    <li>
      <Link href={`/p/${propertyId}/cycles/${cycle.id}`} className="mini">
        <span
          className="pdot"
          style={
            {
              "--g8-c": tone === "upcoming" ? "var(--g8-st-backlog)" : "var(--g8-st-done)",
              borderRadius: "50%",
            } as React.CSSProperties
          }
          aria-hidden
        />
        <span className="trunc" style={{ fontWeight: 500 }}>
          {cycleLabel(cycle)}
        </span>
        <span className="muted num" style={{ flexShrink: 0 }}>
          {formatRange(cycle.starts_on, cycle.ends_on, refYear)}
        </span>
        {meta ? (
          <span className="faint hidden sm:inline" style={{ flexShrink: 0, fontSize: "var(--g8-fs-xs)" }}>
            {meta}
          </span>
        ) : null}
        <span className="sp" />
        {stats.map((s, i) => (
          <span
            key={s}
            className={i > 0 ? "faint num hidden sm:inline" : "faint num"}
            style={{ flexShrink: 0, fontSize: "var(--g8-fs-xs)" }}
          >
            {s}
          </span>
        ))}
        {success !== undefined ? (
          <span
            className={success >= 80 ? "badge green" : success >= 50 ? "badge amber" : "badge red"}
            style={{ flexShrink: 0 }}
          >
            {success}%
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function CurrentCycleCard({
  propertyId,
  cycle,
  today,
  refYear,
  burnup,
  capacityPct,
}: {
  propertyId: string;
  cycle: CycleRow;
  today: DateStr;
  refYear: number;
  burnup: BurnupResult;
  capacityPct: number | null;
}) {
  const s = burnup.stats;
  const daysLeft = diffDays(today, cycle.ends_on);
  return (
    <section className="panel">
      <div className="panel-h" style={{ flexWrap: "wrap" }}>
        <span className="eyebrow">Current</span>
        <Link
          href={`/p/${propertyId}/cycles/${cycle.id}`}
          style={{ fontWeight: 600, fontSize: "var(--g8-fs-md)" }}
          className="hover:underline"
        >
          {cycleLabel(cycle)}
        </Link>
        <span className="muted num" style={{ fontSize: "var(--g8-fs-sm)" }}>
          {formatRange(cycle.starts_on, cycle.ends_on, refYear)}
        </span>
        <div className="acts">
          <span className="badge accent">
            <span className="dot" />
            {daysLeft === 0 ? "Ends today" : `${daysLeft}d left`}
          </span>
        </div>
      </div>
      <div className="panel-b">
        <G8Stats
          items={[
            { k: "Scope", v: s.scope, d: `${s.count} tasks` },
            { k: "Started", v: s.started, d: `${pct(s.started, s.scope)}%` },
            {
              k: "Completed",
              v: s.completed,
              d: `${pct(s.completed, s.scope)}%`,
              tone: s.completed > 0 ? "up" : undefined,
            },
            {
              k: "Capacity",
              v: capacityPct === null ? "—" : `${capacityPct}%`,
              d: capacityPct === null ? "No finished cycles yet" : "of recent throughput",
              tone: capacityPct !== null && capacityPct > 110 ? "bad" : undefined,
            },
          ]}
        />
        <BurnupChart points={burnup.points} className="mt-5" />
        <BurnupLegend className="mt-2" />
      </div>
    </section>
  );
}

function ScopePicker({
  propertyId,
  spaceId,
  scopeName,
  allSettings,
  spaces,
}: {
  propertyId: string;
  spaceId: string | null;
  scopeName: string;
  allSettings: CycleSettingsRow[];
  spaces: { id: string; name: string; color: EntityColor }[];
}) {
  const router = useRouter();
  const withCycles = new Set(
    allSettings.filter((s) => s.enabled).map((s) => s.space_id ?? "property"),
  );
  const rows = [
    { id: null as string | null, name: "Whole property", color: "slate" as const },
    ...spaces,
  ];
  const active = rows.filter((r) => withCycles.has(r.id ?? "property"));
  const inactive = rows.filter((r) => !withCycles.has(r.id ?? "property"));
  const item = (r: (typeof rows)[number]) => (
    <DropdownMenuItem
      key={r.id ?? "property"}
      onClick={() => router.push(cyclesHref(propertyId, r.id))}
      className="gap-2"
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: G8_COLOR[r.color] }}
      />
      <span className="flex-1 truncate">{r.name}</span>
      {r.id === spaceId ? <Check className="size-3.5" /> : null}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className="btn btn-secondary btn-sm">
            {scopeName}
            <Gi icon={ChevronDown} size={13} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {active.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>With cycles</DropdownMenuLabel>
            {active.map(item)}
          </DropdownMenuGroup>
        ) : null}
        {active.length > 0 && inactive.length > 0 ? <DropdownMenuSeparator /> : null}
        {inactive.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Set up cycles</DropdownMenuLabel>
            {inactive.map(item)}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingsPopover({
  propertyId,
  spaceId,
  settings,
}: {
  propertyId: string;
  spaceId: string | null;
  settings: CycleSettingsRow | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="ibtn"
            aria-label="Cycle settings"
            title="Cycle settings"
          >
            <Gi icon={Settings2} size={15} />
          </button>
        }
      />
      <PopoverContent align="end" className="w-80 p-4">
        <CycleSettingsForm
          propertyId={propertyId}
          spaceId={spaceId}
          settings={settings}
          onSaved={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
