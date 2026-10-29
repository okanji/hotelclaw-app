"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import {
  Archive,
  CalendarCheck,
  CheckCheck,
  Flag,
  ListChecks,
  Plus,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Gi } from "@/components/gr8r/icon";
import { ProgBar } from "@/components/gr8r/home-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
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
  const { data: routines = [], isPending: routinesPending } = useQuery(
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
    <div className="stack">
      {dueToday.length > 0 ? (
        <section className="panel">
          <div className="panel-h">
            <h2>
              {signedOff
                ? "Day signed off"
                : dayPct === 100
                  ? "Everything's done — ready to sign off"
                  : "Is today done?"}
            </h2>
            <span className="sp" />
            <span className="faint" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              {ratingTrend
                ? `${ratingTrend.avg}/10 over ${ratingTrend.days}d · `
                : ""}
              {doneItems}/{totalItems} · {dayPct}%
            </span>
            {isManagement ? (
              <button
                type="button"
                className={signedOff ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"}
                disabled={pending || signedOff}
                onClick={() => setRatingOpen(true)}
              >
                <Gi icon={CheckCheck} size={14} />
                {signedOff ? "Signed off" : "Sign off the day"}
              </button>
            ) : null}
          </div>
          <div className="panel-b">
            <ProgBar value={dayPct} tone={dayPct === 100 ? "green" : ""} />
          </div>
        </section>
      ) : null}

      {ratingOpen && !signedOff ? (
        <section className="panel">
          <div className="panel-h">
            <h2>How did the day go?</h2>
          </div>
          <div className="panel-b stack" style={{ gap: 10 }}>
            <div className="seg" role="group" aria-label="Day rating" style={{ flexWrap: "wrap", width: "fit-content" }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={rating === n ? "on" : ""}
                  aria-pressed={rating === n}
                  onClick={() => setRating(rating === n ? null : n)}
                  style={{ minWidth: 28, justifyContent: "center", fontVariantNumeric: "tabular-nums" }}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              className="input"
              value={ratingNote}
              onChange={(e) => setRatingNote(e.target.value)}
              placeholder="Optional note — what went well, what to fix"
              maxLength={500}
            />
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={signOff}>
                <Gi icon={CheckCheck} size={14} />
                {rating ? `Sign off · ${rating}/10` : "Sign off without rating"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pending}
                onClick={() => setRatingOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {routines.length === 0 && !routinesPending && !adding ? (
        <G8Empty
          icon={ListChecks}
          title="No routines yet"
          text="Recurring checklists — opening, closing, shift handover — live here and reset every day."
          sm
        />
      ) : null}

      {dueToday.length === 0 && routines.length > 0 ? (
        <G8Empty
          icon={CalendarCheck}
          title="Nothing scheduled today"
          text={`${routines.length} ${routines.length === 1 ? "routine runs" : "routines run"} on other days.`}
          sm
        />
      ) : null}

      {dueToday.map((routine) => {
        const run = runByRoutine.get(routine.id);
        const done = new Set(run?.done_items ?? []);
        const flags = feedbackByRoutine.get(routine.id) ?? [];
        const complete = done.size === routine.items.length;
        return (
          <section key={routine.id} className="panel">
            <div className="panel-h">
              <h2 className="trunc">{routine.name}</h2>
              <span
                className={complete ? "badge green" : "faint"}
                style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
              >
                {done.size}/{routine.items.length}
              </span>
              <span className="sp" />
              {needsReview(routine) && isManagement ? (
                <button
                  type="button"
                  className="badge amber"
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
                >
                  Review suggested
                </button>
              ) : null}
              <RoutineFlagButton
                propertyId={propertyId}
                routineId={routine.id}
                onFlagged={refresh}
              />
              {isManagement ? (
                <button
                  type="button"
                  className="ibtn ibtn-sm"
                  title="Archive routine"
                  aria-label={`Archive ${routine.name}`}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await archiveRoutine(routine.id);
                      if ("error" in res) toast.error(res.error);
                      refresh();
                    })
                  }
                >
                  <Gi icon={Archive} size={14} />
                </button>
              ) : null}
            </div>
            {isManagement && flags.length > 0 ? (
              <div className="panel-b">
                <div className="alert warn">
                  <Gi icon={Flag} size={14} />
                  <div className="stack" style={{ gap: 2 }}>
                    {flags.slice(0, 4).map((f) => (
                      <span key={f.id}>{f.note}</span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {routine.items.map((item) => {
              const isDoneItem = done.has(item.id);
              return (
                <label key={item.id} className={isDoneItem ? "mini done" : "mini"}>
                  <input
                    type="checkbox"
                    className="check"
                    checked={isDoneItem}
                    disabled={pending}
                    onChange={(e) => toggle(routine.id, item.id, e.target.checked)}
                  />
                  <span className="tt">{item.label}</span>
                </label>
              );
            })}
          </section>
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
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
            <Gi icon={Plus} size={14} />
            New routine
          </button>
        </div>
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
    <section className="panel">
      <div className="panel-h">
        <h2>New routine</h2>
      </div>
      <div className="panel-b stack" style={{ gap: 10 }}>
        <input
          autoFocus
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Routine name — e.g. Morning opening checklist"
          maxLength={120}
        />
        <textarea
          className="textarea"
          value={itemsText}
          onChange={(e) => setItemsText(e.target.value)}
          placeholder={"One checklist item per line:\nUnlock front doors\nCount the float\nCheck reservations for the day"}
          rows={4}
        />
        <div className="seg" role="group" aria-label="Days" style={{ width: "fit-content", flexWrap: "wrap" }}>
          {DAY_LABELS.map((label, day) => (
            <button
              key={day}
              type="button"
              className={days.includes(day) ? "on" : ""}
              aria-pressed={days.includes(day)}
              onClick={() =>
                setDays((d) =>
                  d.includes(day) ? d.filter((x) => x !== day) : [...d, day],
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void submit()}
            disabled={busy || !name.trim() || !itemsText.trim() || days.length === 0}
          >
            Create routine
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <span className="sp" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDays([1, 2, 3, 4, 5])}>
            <Gi icon={RotateCcw} size={13} />
            Weekdays only
          </button>
        </div>
      </div>
    </section>
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
        className="ibtn ibtn-sm"
        title="Flag something about this routine"
        aria-label="Flag this routine"
        onClick={() => setOpen(true)}
      >
        <Gi icon={Flag} size={14} />
      </button>
    );
  }
  return (
    <span className="row" style={{ gap: 4 }}>
      <input
        autoFocus
        className="input"
        style={{ height: 26, width: 192, fontSize: 12 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="What's not working?"
        maxLength={500}
        disabled={busy}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy || !note.trim()}
        onClick={() => void submit()}
      >
        Flag
      </button>
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
    <div
      className="stats"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="stat">
          <span className="k">{stat.label}</span>
          <span className="v">{stat.value}</span>
        </div>
      ))}
    </div>
  );
}
