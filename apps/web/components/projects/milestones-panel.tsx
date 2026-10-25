"use client";

import { useEffect, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Diamond, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  projectMilestonesQueryOptions,
  type Milestone,
} from "@/lib/query/milestone-queries";
import {
  createMilestone,
  deleteMilestone,
  updateMilestone,
} from "./milestone-actions";
import type { MilestoneProgress } from "@/lib/initiatives/planning";
import { OverviewSection } from "./workspace-shell";

const MS_PER_DAY = 86_400_000;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days from today to a `YYYY-MM-DD` (negative = past). */
export function daysUntil(dateOnly: string): number {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const target = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

export function formatMilestoneDate(dateOnly: string) {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function relativeDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 0) return `in ${n} days`;
  return `${-n} days ago`;
}

/** Keep the project's milestone list live for every viewer. */
export function useMilestonesRealtime(projectId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`milestones:${projectId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_milestones",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["milestones"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, qc]);
}

/**
 * The project's milestones — gr8r's "Wireframes signed off · Dev handoff ·
 * Public launch" list: a diamond per row (filled once reached), name, date
 * and distance from today, with one-click reach/unreach and an inline add row.
 * Overdue, unreached milestones read in the warning ink.
 */
export function MilestonesPanel({
  projectId,
  action,
  progress,
}: {
  projectId: string;
  /** Extra header action (the Overview passes nothing; the rail may). */
  action?: React.ReactNode;
  /**
   * Task progress per milestone id (`milestoneProgress` over the project's
   * tasks with `milestone_id`) — renders Linear's "67% of 3". Manual
   * reach/unreach stays the milestone's own state; the % is evidence.
   */
  progress?: Map<string, MilestoneProgress>;
}) {
  const qc = useQueryClient();
  const { data: milestones = [] } = useQuery(projectMilestonesQueryOptions(projectId));
  useMilestonesRealtime(projectId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso);
  const [pending, startTransition] = useTransition();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["milestones"] });
  };

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || !date) return;
    startTransition(async () => {
      const r = await createMilestone({ projectId, name: trimmed, dueDate: date });
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      setName("");
      refresh();
    });
  }

  function toggle(m: Milestone) {
    // Optimistic flip so the diamond fills instantly.
    qc.setQueryData<Milestone[]>(
      projectMilestonesQueryOptions(projectId).queryKey,
      (prev) =>
        (prev ?? []).map((x) =>
          x.id === m.id
            ? { ...x, completed_at: x.completed_at ? null : new Date().toISOString() }
            : x,
        ),
    );
    startTransition(async () => {
      const r = await updateMilestone(m.id, { completed: !m.completed_at });
      if ("error" in r) toast.error(r.error);
      refresh();
    });
  }

  function remove(m: Milestone) {
    qc.setQueryData<Milestone[]>(
      projectMilestonesQueryOptions(projectId).queryKey,
      (prev) => (prev ?? []).filter((x) => x.id !== m.id),
    );
    startTransition(async () => {
      const r = await deleteMilestone(m.id);
      if ("error" in r) toast.error(r.error);
      refresh();
    });
  }

  const reached = milestones.filter((m) => m.completed_at).length;

  return (
    <OverviewSection
      title="Milestones"
      action={
        action ?? (
          <div className="flex items-center gap-2">
            {milestones.length > 0 ? (
              <span className="text-sm tabular-nums text-muted-foreground">
                {reached}/{milestones.length} reached
              </span>
            ) : null}
            {!adding ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-sm"
                onClick={() => setAdding(true)}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            ) : null}
          </div>
        )
      }
    >
      {milestones.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">
          No milestones yet — add the dates this project is judged against.
        </p>
      ) : (
        <ul role="list" className="flex flex-col">
          {milestones.map((m) => {
            const done = Boolean(m.completed_at);
            const n = daysUntil(m.due_date);
            const late = !done && n < 0;
            const prog = progress?.get(m.id);
            return (
              <li
                key={m.id}
                className="group/ms flex min-h-[37px] items-center gap-3 border-t border-border first:border-0"
              >
                <button
                  type="button"
                  onClick={() => toggle(m)}
                  disabled={pending}
                  aria-pressed={done}
                  aria-label={done ? `Reopen ${m.name}` : `Mark ${m.name} reached`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent"
                >
                  <Diamond
                    className={cn(
                      "size-3.5",
                      done
                        ? "fill-success text-success"
                        : late
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}
                  />
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    done ? "text-muted-foreground line-through" : "font-medium text-foreground",
                  )}
                >
                  {m.name}
                </span>
                {prog ? (
                  <span
                    className="flex shrink-0 items-center gap-2"
                    title={`${prog.done} of ${prog.total} issues done`}
                  >
                    <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-muted sm:block">
                      <span
                        className="block h-full rounded-full bg-success/90"
                        style={{ width: `${prog.pct}%` }}
                      />
                    </span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {prog.pct}% of {prog.total}
                    </span>
                  </span>
                ) : null}
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {formatMilestoneDate(m.due_date)}
                </span>
                <span
                  className={cn(
                    "hidden w-24 shrink-0 text-right text-xs tabular-nums sm:inline",
                    done ? "text-success" : late ? "text-warning" : "text-faint-foreground",
                  )}
                >
                  {done ? "Reached" : relativeDays(n)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(m)}
                  aria-label={`Remove ${m.name}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-faint-foreground opacity-0 transition-opacity group-hover/ms:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Diamond className="size-3.5 shrink-0 text-faint-foreground" />
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Milestone name"
            aria-label="Milestone name"
            className="h-8 min-w-0 flex-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
          />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Milestone date"
            className="h-8 w-[9.5rem] text-sm"
          />
          <Button type="submit" size="sm" className="h-8" disabled={pending || !name.trim()}>
            <Check className="size-3.5" />
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setAdding(false);
              setName("");
            }}
            aria-label="Cancel"
          >
            <X className="size-3.5" />
          </Button>
        </form>
      ) : null}
    </OverviewSection>
  );
}
