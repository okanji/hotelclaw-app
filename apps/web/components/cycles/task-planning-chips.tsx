"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Diamond, Gauge, IterationCcw } from "lucide-react";
import { toast } from "sonner";
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
  PROPERTY_CHIP_CLASS as CHIP_BASE,
  PropertyChipIcon as ChipIcon,
} from "@/components/tasks/task-property-menus";
import { updateTask } from "@/components/tasks/actions";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import { projectMilestonesQueryOptions } from "@/lib/query/milestone-queries";
import {
  cyclesQueryOptions,
  type CycleListItem,
} from "@/lib/query/cycle-queries";
import { cycleLabel } from "@/lib/cycles/plan";
import { formatRange } from "@/lib/cycles/dates";
import { ESTIMATE_SCALE } from "@/lib/cycles/scope";
import { cn } from "@/lib/utils";

/** Mirrors the task rail's property rows (`task-detail-sidebar.tsx`). */
const ROW_BASE =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";

function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
      {children}
    </span>
  );
}

type Patch = {
  estimate?: number | null;
  cycleId?: string | null;
  milestoneId?: string | null;
};

/**
 * The planning chips on the task detail strip — Estimate, Cycle, Milestone
 * (migration 0111). Self-contained like `TaskProjectSpacePicker`: reads the
 * task's planning fields + team/project out of the shared tasks list cache
 * and writes through `updateTask` (→ `updateTaskFor`, the web + mobile path,
 * which fences cycle/milestone ids to the task's property and project).
 *
 * Cycle choices are the current + upcoming cycles of the task's team plus
 * the property-wide cadence; Milestone only renders when the task has a
 * project. Both chips hide when there's nothing to pick and nothing set.
 */
export function TaskPlanningChips({
  propertyId,
  taskId,
  variant = "chip",
}: {
  propertyId: string;
  taskId: string;
  /**
   * "chip" = pill chips for the inline strip under the title; "row" =
   * full-width property rows for the task page's right rail (the full-page
   * home of properties, Linear-style). Same pickers, same write path.
   */
  variant?: "chip" | "row";
}) {
  const qc = useQueryClient();
  const [, startTransition] = useTransition();
  const { data: tasks } = useQuery(tasksQueryOptions(propertyId));
  const row = tasks?.find((t) => t.id === taskId);
  const { data: cycles } = useQuery(cyclesQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const projectId = row?.project_id ?? null;
  const { data: milestones = [] } = useQuery({
    ...projectMilestonesQueryOptions(projectId ?? ""),
    enabled: !!projectId,
  });

  // Optimistic overrides until the list refetch lands.
  const [local, setLocal] = useState<Patch>({});
  const estimate =
    local.estimate !== undefined ? local.estimate : (row?.estimate ?? null);
  const cycleId =
    local.cycleId !== undefined ? local.cycleId : (row?.cycle_id ?? null);
  const milestoneId =
    local.milestoneId !== undefined
      ? local.milestoneId
      : (row?.milestone_id ?? null);

  function save(patch: Patch) {
    setLocal((l) => ({ ...l, ...patch }));
    startTransition(async () => {
      const res = await updateTask({ taskId, ...patch });
      if ("error" in res) {
        toast.error(res.error);
        setLocal((l) => {
          const next = { ...l };
          for (const k of Object.keys(patch) as (keyof Patch)[]) delete next[k];
          return next;
        });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
      if (patch.milestoneId !== undefined) {
        void qc.invalidateQueries({ queryKey: ["milestones"] });
      }
      setLocal({});
    });
  }

  if (!row) return null;

  const spaceName = (id: string | null) =>
    id ? (spaces.find((s) => s.id === id)?.name ?? "Team") : "Property";
  const all = cycles?.cycles ?? [];
  const assigned = all.find((c) => c.id === cycleId) ?? null;
  const choices = all
    .filter(
      (c) =>
        c.phase !== "past" &&
        (c.space_id === null || c.space_id === (row.space_id ?? null)),
    )
    .sort(
      (a, b) =>
        Number(a.space_id === null) - Number(b.space_id === null) ||
        (a.starts_on < b.starts_on ? -1 : 1),
    );
  const groups = [...new Set(choices.map((c) => c.space_id))];
  const refYear = cycles ? Number(cycles.today.slice(0, 4)) : undefined;
  const milestone = milestones.find((m) => m.id === milestoneId) ?? null;
  const showCycle = choices.length > 0 || assigned !== null;
  const showMilestone = !!projectId && (milestones.length > 0 || !!milestoneId);
  const asRow = variant === "row";
  const align = asRow ? "end" : "start";
  const trigger = (isSet: boolean) =>
    asRow
      ? cn(ROW_BASE, isSet ? "text-foreground" : "text-muted-foreground")
      : cn(CHIP_BASE, isSet ? "text-foreground" : "text-muted-foreground");
  const Icon = asRow ? RowIcon : ChipIcon;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button type="button" className={trigger(estimate != null)} />
          }
        >
          <Icon>
            <Gauge className="size-3.5" />
          </Icon>
          <span className="truncate">
            {estimate != null
              ? `${estimate} ${estimate === 1 ? "point" : "points"}`
              : asRow
                ? "Set estimate"
                : "Estimate"}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-40">
          {ESTIMATE_SCALE.map((n) => (
            <DropdownMenuItem
              key={n}
              onClick={() => save({ estimate: n })}
              className="gap-2"
            >
              <span className="flex-1 tabular-nums">
                {n} {n === 1 ? "point" : "points"}
              </span>
              {estimate === n ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
          {estimate != null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => save({ estimate: null })}
                className="text-muted-foreground"
              >
                No estimate
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {showCycle ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className={trigger(!!assigned)} />
            }
          >
            <Icon>
              <IterationCcw className="size-3.5" />
            </Icon>
            <span className="truncate">
              {assigned ? cycleLabel(assigned) : asRow ? "Add to cycle" : "Cycle"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={align} className="w-64">
            {groups.map((g) => (
              <DropdownMenuGroup key={g ?? "property"}>
                <DropdownMenuLabel>{spaceName(g)}</DropdownMenuLabel>
                {choices
                  .filter((c) => c.space_id === g)
                  .map((c) => (
                    <CycleItem
                      key={c.id}
                      cycle={c}
                      refYear={refYear}
                      selected={c.id === cycleId}
                      onSelect={() => save({ cycleId: c.id })}
                    />
                  ))}
              </DropdownMenuGroup>
            ))}
            {assigned ? (
              <>
                {choices.length > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  onClick={() => save({ cycleId: null })}
                  className="text-muted-foreground"
                >
                  Remove from {cycleLabel(assigned)}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {showMilestone ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className={trigger(!!milestone)} />
            }
          >
            <Icon>
              <Diamond className="size-3.5" />
            </Icon>
            <span className="truncate">
              {milestone?.name ?? (asRow ? "Set milestone" : "Milestone")}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={align} className="w-60">
            {milestones.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => save({ milestoneId: m.id })}
                className="gap-2"
              >
                <Diamond
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground",
                    m.completed_at && "fill-current",
                  )}
                />
                <span className="flex-1 truncate">{m.name}</span>
                {m.id === milestoneId ? <Check className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
            {milestoneId ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => save({ milestoneId: null })}
                  className="text-muted-foreground"
                >
                  No milestone
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

function CycleItem({
  cycle,
  refYear,
  selected,
  onSelect,
}: {
  cycle: CycleListItem;
  refYear: number | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onClick={onSelect} className="gap-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">
          {cycleLabel(cycle)}
          {cycle.phase === "current" ? (
            <span className="ml-1.5 text-xs text-faint-foreground">Current</span>
          ) : null}
        </span>
        <span className="text-xs text-faint-foreground tabular-nums">
          {formatRange(cycle.starts_on, cycle.ends_on, refYear)}
        </span>
      </span>
      {selected ? <Check className="size-3.5 shrink-0" /> : null}
    </DropdownMenuItem>
  );
}
