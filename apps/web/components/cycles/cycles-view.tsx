"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, IterationCcw, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { StatGroup, Stat } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { Button } from "@/components/ui/button";
import { LABEL_DOT } from "@/components/labels/label-tokens";
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
import { cn } from "@/lib/utils";
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title="Cycles"
        icon={<IterationCcw />}
        meta={
          enabled && settings
            ? `${settings.duration_weeks === 1 ? "Weekly" : `${settings.duration_weeks}-week`} · starts ${WEEKDAY[settings.start_weekday]}${settings.auto_rollover ? " · open work rolls over" : ""}`
            : undefined
        }
        actions={
          <div className="flex items-center gap-1">
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
        }
      />
      <div className="flex-1 overflow-y-auto pb-16">
        <PageShell width="full" className="pt-2">
          {!enabled ? (
            <EmptyState
              icon={IterationCcw}
              title={`Enable cycles for ${scopeName}`}
              className="mt-6"
              action={
                <div className="w-80 max-w-full rounded-card bg-card p-4 shadow-card">
                  <CycleSettingsForm
                    propertyId={propertyId}
                    spaceId={spaceId}
                    settings={settings}
                  />
                </div>
              }
            >
              Plan the work in short, repeating windows. Cycles roll forward on
              their own: the next one is created when this one ends, and
              anything unfinished moves with it.
            </EmptyState>
          ) : (
            <ol role="list" className="flex flex-col">
              {upcoming.length > 0 ? (
                <TimelineGroup label="Upcoming">
                  {upcoming.map((c) => {
                    const stats = burnups.get(c.id)?.stats;
                    return (
                      <CycleRowLink
                        key={c.id}
                        propertyId={propertyId}
                        cycle={c}
                        refYear={refYear}
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

              {current ? (
                <TimelineGroup label="Current">
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
                </TimelineGroup>
              ) : null}

              {past.length > 0 ? (
                <TimelineGroup label="Completed">
                  {past.map((c) => {
                    const stats = burnups.get(c.id)!.stats;
                    return (
                      <CycleRowLink
                        key={c.id}
                        propertyId={propertyId}
                        cycle={c}
                        refYear={refYear}
                        stats={[
                          `${successPct(stats)}% success`,
                          `${stats.completedCount} completed`,
                          `${stats.scope} scope`,
                        ]}
                      />
                    );
                  })}
                </TimelineGroup>
              ) : null}
            </ol>
          )}
        </PageShell>
      </div>
    </div>
  );
}

function TimelineGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1 pb-6">
      <Eyebrow className="px-2 pb-1.5">{label}</Eyebrow>
      <ol role="list" className="flex flex-col gap-px">
        {children}
      </ol>
    </li>
  );
}

function CycleRowLink({
  propertyId,
  cycle,
  refYear,
  meta,
  stats,
}: {
  propertyId: string;
  cycle: CycleRow;
  refYear: number;
  meta?: string;
  stats: string[];
}) {
  return (
    <li>
      <Link
        href={`/p/${propertyId}/cycles/${cycle.id}`}
        className="flex h-[37px] items-center gap-3 rounded-md px-2 text-sm transition-colors hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
      >
        <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
        <span className="min-w-0 truncate font-medium text-foreground">
          {cycleLabel(cycle)}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {formatRange(cycle.starts_on, cycle.ends_on, refYear)}
        </span>
        {meta ? (
          <span className="hidden shrink-0 text-xs text-faint-foreground sm:inline">
            {meta}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {stats.map((s, i) => (
            <span key={s} className={cn(i > 0 && "hidden sm:inline")}>
              {s}
            </span>
          ))}
        </span>
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
    <li className="rounded-card bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={`/p/${propertyId}/cycles/${cycle.id}`}
          className="text-base font-semibold text-foreground hover:underline"
        >
          {cycleLabel(cycle)}
        </Link>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatRange(cycle.starts_on, cycle.ends_on, refYear)}
        </span>
        <StatusBadge tone="info">
          {daysLeft === 0 ? "Ends today" : `${daysLeft}d left`}
        </StatusBadge>
      </div>
      <StatGroup cols={4} className="mt-4">
        <Stat label="Scope" value={s.scope} delta={`${s.count} tasks`} />
        <Stat label="Started" value={s.started} delta={`${pct(s.started, s.scope)}%`} />
        <Stat
          label="Completed"
          value={s.completed}
          delta={`${pct(s.completed, s.scope)}%`}
          tone={s.completed > 0 ? "success" : "neutral"}
        />
        <Stat
          label="Capacity"
          value={capacityPct === null ? "—" : `${capacityPct}%`}
          delta={capacityPct === null ? "No finished cycles yet" : "of recent throughput"}
          tone={capacityPct !== null && capacityPct > 110 ? "warning" : "neutral"}
        />
      </StatGroup>
      <BurnupChart points={burnup.points} className="mt-5" />
      <BurnupLegend className="mt-2" />
    </li>
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
      <span className={cn("size-2 shrink-0 rounded-full", LABEL_DOT[r.color])} />
      <span className="flex-1 truncate">{r.name}</span>
      {r.id === spaceId ? <Check className="size-3.5" /> : null}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="text-secondary-ink">
            {scopeName}
            <ChevronDown className="size-3.5" />
          </Button>
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
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Cycle settings"
            className="text-muted-foreground"
          >
            <Settings2 />
          </Button>
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
