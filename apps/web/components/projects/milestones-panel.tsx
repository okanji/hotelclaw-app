"use client";

import { useEffect, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Gi } from "@/components/gr8r/icon";
import { ProgBar } from "@/components/gr8r/home-glyphs";
import { G8Panel } from "@/components/gr8r/project-page";
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
 * Overdue, unreached milestones read in the warning ink. Rendered as
 * gr8r's Overview "Milestones" `.panel` (src/views/project-overview.js).
 */
export function MilestonesPanel({
  projectId,
  action,
  progress,
  color,
}: {
  projectId: string;
  /** The project's gr8r colour (`var(--g8-…)`) for upcoming diamonds. */
  color?: string;
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
    <G8Panel
      title="Milestones"
      count={milestones.length > 0 ? `${reached}/${milestones.length}` : undefined}
      acts={
        action ??
        (!adding ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <Gi icon={Plus} size={13} />
            Add
          </button>
        ) : null)
      }
    >
      {milestones.length === 0 && !adding ? (
        <span className="faint">No milestones yet — add the dates this project is judged against.</span>
      ) : (
        <div className="col" style={{ gap: 0 }}>
          {milestones.map((m) => {
            const done = Boolean(m.completed_at);
            const n = daysUntil(m.due_date);
            const late = !done && n < 0;
            const prog = progress?.get(m.id);
            // gr8r: a 9px rotated square — green once reached, the
            // project's colour ahead, red when it slipped past unreached.
            const tint = done ? "var(--g8-green)" : late ? "var(--g8-red)" : (color ?? "var(--g8-accent)");
            return (
              <div key={m.id} className="row ms-row" style={{ minHeight: 32, fontSize: 13, gap: 8 }}>
                <button
                  type="button"
                  onClick={() => toggle(m)}
                  disabled={pending}
                  aria-pressed={done}
                  aria-label={done ? `Reopen ${m.name}` : `Mark ${m.name} reached`}
                  title={done ? "Reached — click to reopen" : "Mark reached"}
                  className="ibtn ibtn-xs"
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      transform: "rotate(45deg)",
                      borderRadius: 2,
                      flexShrink: 0,
                      background: done || late ? tint : "transparent",
                      boxShadow: done || late ? undefined : `inset 0 0 0 1.5px ${tint}`,
                    }}
                  />
                </button>
                <span
                  className={done ? "grow trunc faint" : "grow trunc"}
                  style={done ? { textDecoration: "line-through" } : { fontWeight: 500 }}
                >
                  {m.name}
                </span>
                {prog ? (
                  <span
                    className="row"
                    style={{ gap: 6, flexShrink: 0 }}
                    title={`${prog.done} of ${prog.total} issues done`}
                  >
                    <span className="hide-m" style={{ width: 48 }}>
                      <ProgBar value={prog.pct} tone="green" />
                    </span>
                    <span className="num muted" style={{ fontSize: 12 }}>
                      {prog.pct}% of {prog.total}
                    </span>
                  </span>
                ) : null}
                <span className="num muted" style={{ flexShrink: 0 }}>
                  {formatMilestoneDate(m.due_date)}
                </span>
                <span
                  className="num hide-m"
                  style={{
                    width: 76,
                    textAlign: "right",
                    fontSize: 11.5,
                    flexShrink: 0,
                    color: done ? "var(--g8-green)" : late ? "var(--g8-red)" : "var(--g8-text-3)",
                  }}
                >
                  {done ? "Reached" : relativeDays(n)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(m)}
                  aria-label={`Remove ${m.name}`}
                  title="Remove milestone"
                  className="ibtn ibtn-xs ms-del"
                >
                  <Gi icon={Trash2} size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <form
          className="row"
          style={{ gap: 6, flexWrap: "wrap", marginTop: milestones.length ? 8 : 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Milestone name"
            aria-label="Milestone name"
            style={{ flex: 1, minWidth: 140, height: 28 }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
          />
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Milestone date"
            style={{ width: 150, height: 28 }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !name.trim()}>
            <Gi icon={Check} size={13} />
            Add
          </button>
          <button
            type="button"
            className="ibtn ibtn-sm"
            onClick={() => {
              setAdding(false);
              setName("");
            }}
            aria-label="Cancel"
          >
            <Gi icon={X} size={14} />
          </button>
        </form>
      ) : null}
    </G8Panel>
  );
}
