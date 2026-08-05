"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Archive, CheckCheck, Flag, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import type { RoutineItem } from "@/lib/db/types";
import {
  archiveRoutine,
  createRoutine,
  flagRoutine,
  markRoutineReviewed,
  signOffDay,
  toggleRoutineItem,
} from "./routine-actions";

/**
 * Daily operations (B3) — the team's recurring layer, separate from finite
 * projects. Today's routines render as live checklists; the day bar answers
 * "is today done?"; owners/managers stamp the evening sign-off. Runs are
 * lazily created on first check, so untouched days read as untouched.
 */

type RoutineRow = {
  id: string;
  name: string;
  items: RoutineItem[];
  days: number[];
  created_at: string;
  reviewed_at: string | null;
};

type FeedbackRow = {
  id: string;
  routine_id: string;
  note: string;
  created_at: string;
};

const REVIEW_AFTER_DAYS = 90;
const REVIEW_FLAG_THRESHOLD = 2;

function feedbackQueryOptions(propertyId: string, spaceId: string) {
  return queryOptions({
    queryKey: ["routine-feedback", spaceId] as const,
    queryFn: async (): Promise<FeedbackRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("routine_feedback")
        .select("id, routine_id, note, created_at, routines!inner(space_id)")
        .eq("property_id", propertyId)
        .eq("routines.space_id", spaceId)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as FeedbackRow[];
    },
    staleTime: 60_000,
  });
}

type RunRow = {
  routine_id: string;
  done_items: string[];
  completed_at: string | null;
  signed_off_at: string | null;
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function routinesQueryOptions(propertyId: string, spaceId: string) {
  return queryOptions({
    queryKey: ["routines", spaceId] as const,
    queryFn: async (): Promise<RoutineRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("routines")
        .select("id, name, items, days, created_at, reviewed_at")
        .eq("property_id", propertyId)
        .eq("space_id", spaceId)
        .is("archived_at", null)
        .order("position")
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as RoutineRow[];
    },
    staleTime: 60_000,
  });
}

function runsQueryOptions(propertyId: string, spaceId: string, date: string) {
  return queryOptions({
    queryKey: ["routine-runs", spaceId, date] as const,
    queryFn: async (): Promise<RunRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("routine_runs")
        .select("routine_id, done_items, completed_at, signed_off_at, routines!inner(space_id)")
        .eq("property_id", propertyId)
        .eq("run_date", date)
        .eq("routines.space_id", spaceId);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as RunRow[];
    },
    staleTime: 15_000,
  });
}

function ratingTrendQueryOptions(propertyId: string, spaceId: string) {
  return queryOptions({
    queryKey: ["routine-rating-trend", spaceId] as const,
    queryFn: async (): Promise<{ avg: number; days: number } | null> => {
      const supabase = createClient();
      const since = new Date(Date.now() - 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const { data } = await supabase
        .from("routine_runs")
        .select("rating, run_date, routines!inner(space_id)")
        .eq("property_id", propertyId)
        .eq("routines.space_id", spaceId)
        .gte("run_date", since)
        .not("rating", "is", null);
      const rows = (data ?? []) as unknown as { rating: number; run_date: string }[];
      if (rows.length === 0) return null;
      // One rating per day (sign-off stamps every run identically) — average
      // the per-day values, not the raw rows.
      const byDay = new Map<string, number>();
      for (const r of rows) byDay.set(r.run_date, r.rating);
      const values = [...byDay.values()];
      return {
        avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
        days: values.length,
      };
    },
    staleTime: 5 * 60_000,
  });
}

export function DailyOpsPanel({
  propertyId,
  spaceId,
}: {
  propertyId: string;
  spaceId: string;
}) {
  const queryClient = useQueryClient();
  // Sign-off/archive affordances are management-only (server-enforced too).
  const { data: isManagement = false } = useQuery({
    queryKey: ["my-role-is-management", propertyId] as const,
    queryFn: async (): Promise<boolean> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase
        .from("memberships")
        .select("role")
        .eq("property_id", propertyId)
        .eq("user_id", user.id)
        .maybeSingle();
      return data?.role === "owner" || data?.role === "manager";
    },
    staleTime: 10 * 60_000,
  });
  const date = todayISO();
  const weekday = new Date().getDay();
  const { data: routines = [] } = useQuery(
    routinesQueryOptions(propertyId, spaceId),
  );
  const { data: runs = [] } = useQuery(
    runsQueryOptions(propertyId, spaceId, date),
  );
  const { data: ratingTrend } = useQuery(
    ratingTrendQueryOptions(propertyId, spaceId),
  );
  const { data: feedback = [] } = useQuery(
    feedbackQueryOptions(propertyId, spaceId),
  );
  const feedbackByRoutine = useMemo(() => {
    const map = new Map<string, FeedbackRow[]>();
    for (const f of feedback) {
      const list = map.get(f.routine_id) ?? [];
      list.push(f);
      map.set(f.routine_id, list);
    }
    return map;
  }, [feedback]);

  // G3 review nudge: flags accumulated, or nobody has relooked in 90 days.
  // (Timestamp captured once per mount — render-pure per the compiler rules.)
  const [nowTs] = useState(() => Date.now());
  const needsReview = (r: RoutineRow): boolean => {
    const flags = feedbackByRoutine.get(r.id)?.length ?? 0;
    if (flags >= REVIEW_FLAG_THRESHOLD) return true;
    const last = new Date(r.reviewed_at ?? r.created_at).getTime();
    return nowTs - last > REVIEW_AFTER_DAYS * 86_400_000;
  };
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const dueToday = useMemo(
    () => routines.filter((r) => r.days.includes(weekday)),
    [routines, weekday],
  );
  const runByRoutine = useMemo(
    () => new Map(runs.map((r) => [r.routine_id, r])),
    [runs],
  );

  const totalItems = dueToday.reduce((n, r) => n + r.items.length, 0);
  const doneItems = dueToday.reduce(
    (n, r) => n + (runByRoutine.get(r.id)?.done_items.length ?? 0),
    0,
  );
  const dayPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
  const signedOff = dueToday.length > 0 && dueToday.every(
    (r) => runByRoutine.get(r.id)?.signed_off_at,
  );

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["routine-runs", spaceId, date] });
    void queryClient.invalidateQueries({ queryKey: ["routines", spaceId] });
    void queryClient.invalidateQueries({ queryKey: ["routine-rating-trend", spaceId] });
    void queryClient.invalidateQueries({ queryKey: ["routine-feedback", spaceId] });
    // The Overview tab's scoreboard and the cross-team Insights table read
    // the same runs — without these, ticking or signing off leaves them
    // stale until a reload.
    void queryClient.invalidateQueries({ queryKey: ["routine-scoreboard", spaceId] });
    void queryClient.invalidateQueries({ queryKey: ["teams-pulse", propertyId] });
  }

  function toggle(routineId: string, itemId: string, done: boolean) {
    startTransition(async () => {
      const res = await toggleRoutineItem({
        propertyId,
        routineId,
        runDate: date,
        itemId,
        done,
      });
      if ("error" in res) toast.error(res.error);
      refresh();
    });
  }

  const [ratingOpen, setRatingOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingNote, setRatingNote] = useState("");

  function signOff() {
    startTransition(async () => {
      const res = await signOffDay({
        propertyId,
        spaceId,
        runDate: date,
        rating: rating ?? undefined,
        ratingNote: ratingNote || undefined,
      });
      if ("error" in res) toast.error(res.error);
      else toast.success("Day signed off");
      setRatingOpen(false);
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {dueToday.length > 0 ? (
        <div className="flex items-center gap-3 rounded-md bg-muted px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-foreground">
                {signedOff
                  ? "Day signed off"
                  : dayPct === 100
                    ? "Everything's done — ready to sign off"
                    : "Is today done?"}
              </p>
              <span className="text-xs tabular-nums text-muted-foreground">
                {ratingTrend
                  ? `${ratingTrend.avg}/10 over ${ratingTrend.days}d · `
                  : ""}
                {doneItems}/{totalItems} · {dayPct}%
              </span>
            </div>
            <Progress value={dayPct} className="h-1.5" />
          </div>
          {isManagement ? (
            <Button
              type="button"
              size="sm"
              variant={signedOff ? "ghost" : "outline"}
              disabled={pending || signedOff}
              onClick={() => setRatingOpen(true)}
            >
              <CheckCheck className="size-4" />
              {signedOff ? "Signed off" : "Sign off the day"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {ratingOpen && !signedOff ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted p-4">
          <p className="text-sm font-medium text-foreground">
            How did the day go?
          </p>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                className={cn(
                  "size-8 rounded-md text-sm font-medium tabular-nums transition-colors",
                  rating === n
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <Input
            value={ratingNote}
            onChange={(e) => setRatingNote(e.target.value)}
            placeholder="Optional note — what went well, what to fix"
            maxLength={500}
            className="h-8 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={signOff}>
              <CheckCheck className="size-4" />
              {rating ? `Sign off · ${rating}/10` : "Sign off without rating"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setRatingOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {dueToday.length === 0 && routines.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing scheduled today — {routines.length}{" "}
          {routines.length === 1 ? "routine runs" : "routines run"} on other
          days.
        </p>
      ) : null}

      {dueToday.map((routine) => {
        const run = runByRoutine.get(routine.id);
        const done = new Set(run?.done_items ?? []);
        return (
          <div
            key={routine.id}
            className="flex flex-col gap-2 rounded-md bg-muted p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-foreground">
                {routine.name}
              </h4>
              <div className="flex items-center gap-2">
                {needsReview(routine) && isManagement ? (
                  <button
                    type="button"
                    disabled={pending}
                    title="Flags or staleness suggest a relook — clicking marks it reviewed"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await markRoutineReviewed(routine.id);
                        if ("error" in res) toast.error(res.error);
                        else toast.success("Marked reviewed");
                        refresh();
                      })
                    }
                    className="rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
                  >
                    Review suggested
                  </button>
                ) : null}
                <RoutineFlagButton
                  propertyId={propertyId}
                  routineId={routine.id}
                  onFlagged={refresh}
                />
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    done.size === routine.items.length
                      ? "text-success"
                      : "text-muted-foreground",
                  )}
                >
                  {done.size}/{routine.items.length}
                </span>
                {isManagement ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="Archive routine"
                    aria-label={`Archive ${routine.name}`}
                    className="size-6 text-muted-foreground"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await archiveRoutine(routine.id);
                        if ("error" in res) toast.error(res.error);
                        refresh();
                      })
                    }
                  >
                    <Archive className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
            {isManagement && (feedbackByRoutine.get(routine.id)?.length ?? 0) > 0 ? (
              <ul className="flex flex-col gap-0.5 rounded-card bg-warning/10 p-3">
                {feedbackByRoutine.get(routine.id)!.slice(0, 4).map((f) => (
                  <li key={f.id} className="text-xs text-faint-foreground">
                    <Flag className="mr-1.5 inline size-3 text-warning" />
                    {f.note}
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="flex flex-col gap-1">
              {routine.items.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-accent">
                    <Checkbox
                      checked={done.has(item.id)}
                      disabled={pending}
                      onCheckedChange={(c) =>
                        toggle(routine.id, item.id, c === true)
                      }
                    />
                    <span
                      className={cn(
                        done.has(item.id) &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {item.label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {adding ? (
        <NewRoutineForm
          propertyId={propertyId}
          spaceId={spaceId}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" />
          New routine
        </Button>
      )}
    </div>
  );
}

/* ── Create form ─────────────────────────────────────────────────────────── */

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function NewRoutineForm({
  propertyId,
  spaceId,
  onDone,
  onCancel,
}: {
  propertyId: string;
  spaceId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const labels = itemsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim() || labels.length === 0 || days.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await createRoutine({
        propertyId,
        spaceId,
        name: name.trim(),
        itemLabels: labels,
        days,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Routine created");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md bg-muted p-4">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Routine name — e.g. Morning opening checklist"
        maxLength={120}
        className="h-8"
      />
      <Textarea
        value={itemsText}
        onChange={(e) => setItemsText(e.target.value)}
        placeholder={"One checklist item per line:\nUnlock front doors\nCount the float\nCheck reservations for the day"}
        rows={4}
        className="text-sm"
      />
      <div className="flex flex-wrap items-center gap-1">
        {DAY_LABELS.map((label, day) => (
          /* Day toggles are the house Chip: a control you PRESS, so it stays
             on the 6px clickable rung at the 14px UI size — not a 12px pill. */
          <Chip
            key={day}
            size="sm"
            selected={days.includes(day)}
            onClick={() =>
              setDays((d) =>
                d.includes(day) ? d.filter((x) => x !== day) : [...d, day],
              )
            }
          >
            {label}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !itemsText.trim() || days.length === 0}
        >
          Create routine
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <button
          type="button"
          onClick={() => setDays([1, 2, 3, 4, 5])}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-3" />
          Weekdays only
        </button>
      </div>
    </div>
  );
}

/* ── Staff feedback ("this doesn't work well") ───────────────────────────── */

function RoutineFlagButton({
  propertyId,
  routineId,
  onFlagged,
}: {
  propertyId: string;
  routineId: string;
  onFlagged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = note.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await flagRoutine({ propertyId, routineId, note: trimmed });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Noted — your manager will see it");
      setNote("");
      setOpen(false);
      onFlagged();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        title="Flag something about this routine"
        aria-label="Flag this routine"
        onClick={() => setOpen(true)}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent"
      >
        <Flag className="size-3.5" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="What's not working?"
        maxLength={500}
        disabled={busy}
        className="h-7 w-48 text-xs"
      />
      <Button
        type="button"
        size="sm"
        className="h-7 text-xs"
        disabled={busy || !note.trim()}
        onClick={() => void submit()}
      >
        Flag
      </Button>
    </span>
  );
}

/* ── Team scoreboard (D2) — 14-day pulse for the Overview tab ────────────── */

function scoreboardQueryOptions(propertyId: string, spaceId: string) {
  return queryOptions({
    queryKey: ["routine-scoreboard", spaceId] as const,
    queryFn: async (): Promise<{
      avgRating: number | null;
      signedOffDays: number;
      completedRuns: number;
      totalRuns: number;
    }> => {
      const supabase = createClient();
      const since = new Date(Date.now() - 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const { data } = await supabase
        .from("routine_runs")
        .select(
          "run_date, completed_at, signed_off_at, rating, routines!inner(space_id)",
        )
        .eq("property_id", propertyId)
        .eq("routines.space_id", spaceId)
        .gte("run_date", since);
      const rows = (data ?? []) as unknown as {
        run_date: string;
        completed_at: string | null;
        signed_off_at: string | null;
        rating: number | null;
      }[];
      const ratingByDay = new Map<string, number>();
      const signedDays = new Set<string>();
      let completed = 0;
      for (const r of rows) {
        if (r.rating != null) ratingByDay.set(r.run_date, r.rating);
        if (r.signed_off_at) signedDays.add(r.run_date);
        if (r.completed_at) completed++;
      }
      const ratings = [...ratingByDay.values()];
      return {
        avgRating:
          ratings.length > 0
            ? Math.round(
                (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10,
              ) / 10
            : null,
        signedOffDays: signedDays.size,
        completedRuns: completed,
        totalRuns: rows.length,
      };
    },
    staleTime: 5 * 60_000,
  });
}

/** Compact 14-day team pulse — rendered on the team Overview tab. Hidden
 *  entirely until the team runs daily ops (no empty-state noise). */
export function TeamScoreboard({
  propertyId,
  spaceId,
}: {
  propertyId: string;
  spaceId: string;
}) {
  const { data } = useQuery(scoreboardQueryOptions(propertyId, spaceId));
  if (!data || data.totalRuns === 0) return null;
  const stats: { label: string; value: string }[] = [
    ...(data.avgRating != null
      ? [{ label: "Day rating (14d)", value: `${data.avgRating}/10` }]
      : []),
    { label: "Days signed off (14d)", value: String(data.signedOffDays) },
    {
      label: "Routines completed (14d)",
      value: `${data.completedRuns}/${data.totalRuns}`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-md bg-muted px-4 py-3"
        >
          <p className="text-2xl leading-8 font-semibold text-foreground tabular-nums">
            {stat.value}
          </p>
          <p className="text-xs text-faint-foreground">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}
