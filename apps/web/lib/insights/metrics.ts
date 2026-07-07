import "server-only";
/**
 * Insights metrics — the single source of truth for every aggregate the
 * Insights section shows AND every number the insights bot narrates. The
 * dashboard API route and the bot's scoped tools both call these functions,
 * so the AI provably reports the same figures the charts render.
 *
 * Current-state reads come from `tasks`; time-series come from
 * `workflow_events` because `tasks` has no `completed_at` — the
 * `tasks_emit_workflow_events()` trigger (migration 0040) records every
 * transition with payload `{old, new, from, to}`, so `payload->>'to'` is the
 * canonical status extraction and `payload->'new'->>'assignee_id'` the
 * assignee at transition time.
 *
 * All reads go through the service-role client with explicit `property_id`
 * filters (the same isolation pattern as `lib/ai/tools.ts`) — callers are
 * responsible for membership checks before invoking.
 */
import { createServiceClient } from "@/lib/supabase/server";
import type { InsightScope } from "./scope";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type OpenStatus = "todo" | "in_progress" | "blocked";

export type OpenWorkSnapshot = {
  byStatus: { status: OpenStatus; count: number; overdue: number }[];
  openTotal: number;
  overdueTotal: number;
};

export type FlowWeek = {
  /** ISO date of the Monday starting the week. */
  weekStart: string;
  /** Short axis label, e.g. "May 26". */
  label: string;
  created: number;
  done: number;
};

export type AttentionKind =
  | "blocked"
  | "overdue"
  | "likely_to_slip"
  | "unassigned_urgent";

export type AttentionItem = {
  taskId: string;
  title: string;
  kind: AttentionKind;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Days blocked (blocked), days overdue (overdue), or days until due
   *  (likely_to_slip — the runway that's shorter than the typical cycle). */
  ageDays: number;
};

export type SlipCohort = "urgent_high" | "standard" | "all";

export type SlipFlag = {
  taskId: string;
  dueInDays: number;
  /** p75 cycle-time days of the cohort this task was compared against. */
  p75Days: number;
  cohort: SlipCohort;
  /** Completed-task sample size behind that p75. */
  sample: number;
};

export type SlipInfo = {
  count: number;
  /** Total completed-task sample behind the distributions. */
  sample: number;
  p75ByCohort: { cohort: SlipCohort; p75Days: number; sample: number }[];
  /** The per-task flags behind `count` — exact runway vs p75 numbers. */
  flags: SlipFlag[];
};

export type CycleTime = {
  /** Median days from creation to done over the trailing 4 weeks. */
  medianDays: number | null;
  /** Median over the 4 weeks before that, for the delta. */
  prevMedianDays: number | null;
  sample: number;
};

export type PaceFlag = "on_pace" | "behind" | "at_risk";

export type PortfolioRow = {
  projectId: string;
  name: string;
  color: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  total: number;
  done: number;
  blocked: number;
  overdue: number;
  completionPct: number;
  pace: PaceFlag;
  paceReasons: string[];
};

export type WorkloadRow = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  open: number;
  blocked: number;
  overdue: number;
  urgent: number;
  /** Tasks completed per week, oldest → newest (4 weeks). */
  doneByWeek: number[];
  /** Meetings attended (accepted/organized) in the last 7 days. */
  meetingsCount: number;
  /** Hours in those meetings (ended meetings only). */
  meetingHours: number;
};

export type MyWeek = {
  doneThisWeek: number;
  /** Own completions per week, oldest → newest (6 weeks). */
  doneByWeek: { label: string; done: number }[];
  openTotal: number;
  overdueTotal: number;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  project_id: string | null;
  space_id: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  event_type: string;
  entity_id: string | null;
  received_at: string;
  to: string | null;
  event_assignee: string | null;
  event_project: string | null;
  event_space: string | null;
};

type ProfileRow = { id: string; full_name: string | null; avatar_url: string | null };

/** Monday 00:00 (local server time) of the week containing `ts`. */
export function weekStartOf(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d;
}

function weekLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type TaskRollup = {
  total: number;
  done: number;
  blocked: number;
  overdue: number;
  completionPct: number;
};

function rollupTasks(list: TaskRow[], now: number): TaskRollup {
  const total = list.length;
  const done = list.filter((t) => t.status === "done").length;
  const blocked = list.filter((t) => t.status === "blocked").length;
  const overdue = list.filter(
    (t) =>
      t.status !== "done" && !!t.due_at && new Date(t.due_at).getTime() < now,
  ).length;
  return {
    total,
    done,
    blocked,
    overdue,
    completionPct: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

/**
 * The merged at-risk heuristic — deterministic; the bot narrates these flags
 * but never computes risk itself. Behind pace if completion lags the elapsed
 * fraction of start→target by >20pts; escalating reasons stack to at_risk.
 */
function paceFor(
  dates: { start_date: string | null; target_date: string | null },
  rollup: TaskRollup,
  now: number,
): { pace: PaceFlag; paceReasons: string[] } {
  const paceReasons: string[] = [];
  if (dates.start_date && dates.target_date && rollup.total > 0) {
    const start = new Date(dates.start_date).getTime();
    const target = new Date(dates.target_date).getTime();
    if (target > start) {
      const elapsed = Math.min(1, Math.max(0, (now - start) / (target - start)));
      if (rollup.done / rollup.total < elapsed - 0.2)
        paceReasons.push(
          `${rollup.completionPct}% complete vs ${Math.round(elapsed * 100)}% of schedule elapsed`,
        );
    }
  }
  if (
    rollup.blocked > 0 &&
    dates.target_date &&
    new Date(dates.target_date).getTime() - now < 14 * DAY_MS
  )
    paceReasons.push(
      `${rollup.blocked} blocked with under 14 days to target`,
    );
  if (rollup.overdue > 2) paceReasons.push(`${rollup.overdue} tasks overdue`);

  const pace: PaceFlag =
    paceReasons.length >= 2
      ? "at_risk"
      : paceReasons.length === 1
        ? "behind"
        : "on_pace";
  return { pace, paceReasons };
}

/** Completed-task sample under the slip distribution must reach this size
 *  before any prediction is made — a cold workspace has no basis for one. */
const SLIP_MIN_SAMPLE = 5;

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const v = lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
  return Math.round(v * 10) / 10;
}

/** Created→done durations (days) with the finished task's priority, from the
 *  same event maps cycle time uses. Tasks deleted since completion fall back
 *  to the "standard" band via a medium priority. */
function cycleSamples(
  events: EventRow[],
  taskById: Map<string, TaskRow>,
): { days: number; priority: string }[] {
  const createdAt = new Map<string, number>();
  const doneAt = new Map<string, number>();
  for (const e of events) {
    if (!e.entity_id) continue;
    if (e.event_type === "task.created" && !createdAt.has(e.entity_id))
      createdAt.set(e.entity_id, new Date(e.received_at).getTime());
    if (
      e.event_type === "task.status_changed" &&
      e.to === "done" &&
      !doneAt.has(e.entity_id)
    )
      doneAt.set(e.entity_id, new Date(e.received_at).getTime());
  }
  const out: { days: number; priority: string }[] = [];
  for (const [id, done] of doneAt) {
    const created = createdAt.get(id);
    if (created === undefined || done < created) continue;
    out.push({
      days: (done - created) / DAY_MS,
      priority: taskById.get(id)?.priority ?? "medium",
    });
  }
  return out;
}

/**
 * Deterministic pre-breach flags: an open, due-dated, not-yet-late task is
 * "likely to slip" when its remaining runway is shorter than the p75 cycle
 * time of comparable completed work. Cohorts are priority bands (urgent/high
 * vs the rest), falling back to the all-tasks distribution below
 * SLIP_MIN_SAMPLE — and to NO flags at all when even the global sample is
 * that thin. Blocked and overdue tasks are excluded: they already have their
 * own attention kinds.
 */
function computeSlipFlags(
  open: TaskRow[],
  samples: { days: number; priority: string }[],
  now: number,
): { flags: SlipFlag[]; info: SlipInfo } {
  if (samples.length < SLIP_MIN_SAMPLE)
    return {
      flags: [],
      info: { count: 0, sample: samples.length, p75ByCohort: [], flags: [] },
    };
  const isHot = (p: string) => p === "urgent" || p === "high";
  const hot = samples.filter((s) => isHot(s.priority)).map((s) => s.days);
  const std = samples.filter((s) => !isHot(s.priority)).map((s) => s.days);
  const all = samples.map((s) => s.days);
  const cohorts: SlipInfo["p75ByCohort"] = [
    ...(hot.length >= SLIP_MIN_SAMPLE
      ? [
          {
            cohort: "urgent_high" as const,
            p75Days: percentile(hot, 75),
            sample: hot.length,
          },
        ]
      : []),
    ...(std.length >= SLIP_MIN_SAMPLE
      ? [
          {
            cohort: "standard" as const,
            p75Days: percentile(std, 75),
            sample: std.length,
          },
        ]
      : []),
    { cohort: "all" as const, p75Days: percentile(all, 75), sample: all.length },
  ];
  const byCohort = new Map(cohorts.map((c) => [c.cohort, c]));

  const flags: SlipFlag[] = [];
  for (const t of open) {
    if (!t.due_at || t.status === "blocked" || t.status === "done") continue;
    const dueIn = (new Date(t.due_at).getTime() - now) / DAY_MS;
    if (dueIn < 0) continue;
    const want: SlipCohort = isHot(t.priority) ? "urgent_high" : "standard";
    const c = byCohort.get(want) ?? byCohort.get("all")!;
    if (dueIn < c.p75Days) {
      flags.push({
        taskId: t.id,
        dueInDays: Math.round(dueIn * 10) / 10,
        p75Days: c.p75Days,
        cohort: c.cohort,
        sample: c.sample,
      });
    }
  }
  return {
    flags,
    info: {
      count: flags.length,
      sample: samples.length,
      p75ByCohort: cohorts,
      flags,
    },
  };
}

/**
 * One fetch pass shared by every metric — tasks (current state), 8 weeks of
 * task events (transitions), and the profiles behind any referenced user.
 * Hotel scale is hundreds of tasks, so in-process aggregation beats RPC
 * plumbing; the SQL shapes live in the spec, the grouping lives here.
 */
async function fetchRaw(propertyId: string) {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - 8 * WEEK_MS).toISOString();

  const [tasksRes, eventsRes] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, status, priority, assignee_id, project_id, space_id, due_at, created_at, updated_at",
      )
      .eq("property_id", propertyId),
    supabase
      .from("workflow_events")
      // The alias string is widened to plain `string` so supabase-js doesn't
      // type-level-parse the JSON-path selectors (TS2589); rows are cast to
      // `EventRow` below instead.
      .select(
        "event_type, entity_id, received_at, to:payload->>to, event_assignee:payload->new->>assignee_id, event_project:payload->new->>project_id, event_space:payload->new->>space_id" as string,
      )
      .eq("property_id", propertyId)
      .in("event_type", ["task.created", "task.status_changed"])
      .gte("received_at", since)
      .order("received_at", { ascending: true })
      .limit(10000),
  ]);

  if (tasksRes.error) throw new Error(`tasks query failed: ${tasksRes.error.message}`);
  if (eventsRes.error) throw new Error(`events query failed: ${eventsRes.error.message}`);

  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const events = (eventsRes.data ?? []) as unknown as EventRow[];

  const userIds = new Set<string>();
  for (const t of tasks) if (t.assignee_id) userIds.add(t.assignee_id);
  for (const e of events) if (e.event_assignee) userIds.add(e.event_assignee);

  let profiles: ProfileRow[] = [];
  if (userIds.size > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", [...userIds]);
    profiles = (data ?? []) as ProfileRow[];
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  return { supabase, tasks, events, profileById };
}

export type InsightsMetrics = {
  snapshot: OpenWorkSnapshot;
  flow: FlowWeek[];
  attention: AttentionItem[];
  cycleTime: CycleTime;
  slip: SlipInfo;
  portfolio: PortfolioRow[];
  workload: WorkloadRow[];
  generatedAt: string;
};

/** Narrow tasks + events to the scope's slice. Tasks filter on their own
 *  columns; events filter on the row snapshot in `payload.new`, so history
 *  follows the task's project/space/assignee at the time of the event. */
function filterToScope(
  tasks: TaskRow[],
  events: EventRow[],
  scope: InsightScope,
): { tasks: TaskRow[]; events: EventRow[] } {
  switch (scope.kind) {
    case "property":
      return { tasks, events };
    case "project":
      return {
        tasks: tasks.filter((t) => t.project_id === scope.id),
        events: events.filter((e) => e.event_project === scope.id),
      };
    case "space":
      return {
        tasks: tasks.filter((t) => t.space_id === scope.id),
        events: events.filter((e) => e.event_space === scope.id),
      };
    case "person":
      return {
        tasks: tasks.filter((t) => t.assignee_id === scope.id),
        events: events.filter((e) => e.event_assignee === scope.id),
      };
  }
}

/** Everything the management views (and the AI generators) need, in one
 *  pass — optionally narrowed to a project / space / person scope. */
export async function computeInsightsMetrics(
  propertyId: string,
  scope: InsightScope = { kind: "property" },
): Promise<InsightsMetrics> {
  const raw = await fetchRaw(propertyId);
  const { supabase, profileById } = raw;
  const { tasks, events } = filterToScope(raw.tasks, raw.events, scope);
  const now = Date.now();

  // ── Open-work snapshot ────────────────────────────────────────────────────
  const open = tasks.filter((t) => t.status !== "done");
  const isOverdue = (t: TaskRow) =>
    !!t.due_at && new Date(t.due_at).getTime() < now;
  const statuses: OpenStatus[] = ["todo", "in_progress", "blocked"];
  const snapshot: OpenWorkSnapshot = {
    byStatus: statuses.map((status) => {
      const rows = open.filter((t) => t.status === status);
      return {
        status,
        count: rows.length,
        overdue: rows.filter(isOverdue).length,
      };
    }),
    openTotal: open.length,
    overdueTotal: open.filter(isOverdue).length,
  };

  // ── Flow balance: created vs completed per week, 8 weeks ─────────────────
  const firstWeek = weekStartOf(now - 7 * WEEK_MS);
  const flow: FlowWeek[] = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(firstWeek.getTime() + i * WEEK_MS);
    return {
      weekStart: start.toISOString().slice(0, 10),
      label: weekLabel(start),
      created: 0,
      done: 0,
    };
  });
  const bucketIndex = (iso: string) => {
    const idx = Math.floor(
      (new Date(iso).getTime() - firstWeek.getTime()) / WEEK_MS,
    );
    return idx >= 0 && idx < flow.length ? idx : null;
  };
  for (const e of events) {
    const idx = bucketIndex(e.received_at);
    if (idx === null) continue;
    if (e.event_type === "task.created") flow[idx].created += 1;
    else if (e.event_type === "task.status_changed" && e.to === "done")
      flow[idx].done += 1;
  }

  // ── Attention list: blocked (aged) + overdue + unassigned urgent ─────────
  // Latest blocked transition per task gives true blocked-age; tasks blocked
  // longer than the 8-week event window fall back to updated_at.
  const blockedSince = new Map<string, number>();
  for (const e of events) {
    if (e.event_type === "task.status_changed" && e.to === "blocked" && e.entity_id)
      blockedSince.set(e.entity_id, new Date(e.received_at).getTime());
  }
  const nameOf = (id: string | null) =>
    id ? (profileById.get(id)?.full_name ?? null) : null;
  const attention: AttentionItem[] = [];
  for (const t of open) {
    if (t.status === "blocked") {
      const since = blockedSince.get(t.id) ?? new Date(t.updated_at).getTime();
      attention.push({
        taskId: t.id,
        title: t.title,
        kind: "blocked",
        priority: t.priority,
        assigneeId: t.assignee_id,
        assigneeName: nameOf(t.assignee_id),
        ageDays: Math.max(0, Math.floor((now - since) / DAY_MS)),
      });
    } else if (isOverdue(t)) {
      attention.push({
        taskId: t.id,
        title: t.title,
        kind: "overdue",
        priority: t.priority,
        assigneeId: t.assignee_id,
        assigneeName: nameOf(t.assignee_id),
        ageDays: Math.floor((now - new Date(t.due_at!).getTime()) / DAY_MS),
      });
    } else if (
      !t.assignee_id &&
      (t.priority === "high" || t.priority === "urgent")
    ) {
      attention.push({
        taskId: t.id,
        title: t.title,
        kind: "unassigned_urgent",
        priority: t.priority,
        assigneeId: null,
        assigneeName: null,
        ageDays: Math.floor((now - new Date(t.created_at).getTime()) / DAY_MS),
      });
    }
  }
  // Blocked first (oldest at top), then overdue by how late, then slip risks
  // by tightest runway, then unassigned. Slip items sort ascending — the
  // soonest-due is the most urgent.
  const kindRank: Record<AttentionKind, number> = {
    blocked: 0,
    overdue: 1,
    likely_to_slip: 2,
    unassigned_urgent: 3,
  };
  const attentionOrder = (a: AttentionItem, b: AttentionItem) =>
    kindRank[a.kind] - kindRank[b.kind] ||
    (a.kind === "likely_to_slip"
      ? a.ageDays - b.ageDays
      : b.ageDays - a.ageDays);
  attention.sort(attentionOrder);

  // ── Cycle time: median created→done, trailing 4wk vs the 4wk before ──────
  const createdAt = new Map<string, number>();
  const doneAt = new Map<string, number>();
  for (const e of events) {
    if (!e.entity_id) continue;
    if (e.event_type === "task.created" && !createdAt.has(e.entity_id))
      createdAt.set(e.entity_id, new Date(e.received_at).getTime());
    if (
      e.event_type === "task.status_changed" &&
      e.to === "done" &&
      !doneAt.has(e.entity_id)
    )
      doneAt.set(e.entity_id, new Date(e.received_at).getTime());
  }
  const recent: number[] = [];
  const previous: number[] = [];
  for (const [id, done] of doneAt) {
    const created = createdAt.get(id);
    if (created === undefined || done < created) continue;
    const days = (done - created) / DAY_MS;
    if (done > now - 4 * WEEK_MS) recent.push(days);
    else previous.push(days);
  }
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return Math.round(m * 10) / 10;
  };
  const cycleTime: CycleTime = {
    medianDays: median(recent),
    prevMedianDays: median(previous),
    sample: recent.length,
  };

  // ── Likely-to-slip: runway vs the p75 of comparable completed work ───────
  // Reuses the created/done maps above; durations over the whole 8-week
  // window give the distribution its best sample. Tasks already in the
  // attention list (blocked / overdue / unassigned-urgent) keep their kind.
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const slipSamples: { days: number; priority: string }[] = [];
  for (const [id, done] of doneAt) {
    const created = createdAt.get(id);
    if (created === undefined || done < created) continue;
    slipSamples.push({
      days: (done - created) / DAY_MS,
      priority: taskById.get(id)?.priority ?? "medium",
    });
  }
  const { flags: slipFlags, info: slip } = computeSlipFlags(
    open,
    slipSamples,
    now,
  );
  const attentionIds = new Set(attention.map((a) => a.taskId));
  for (const f of slipFlags) {
    if (attentionIds.has(f.taskId)) continue;
    const t = taskById.get(f.taskId);
    if (!t) continue;
    attention.push({
      taskId: t.id,
      title: t.title,
      kind: "likely_to_slip",
      priority: t.priority,
      assigneeId: t.assignee_id,
      assigneeName: nameOf(t.assignee_id),
      ageDays: Math.max(0, Math.floor(f.dueInDays)),
    });
  }
  attention.sort(attentionOrder);

  // ── Project portfolio with deterministic pace flags ──────────────────────
  // Non-property scopes roll up only the scoped slice of each project's
  // tasks (a team's share of a project, a person's share, …) and drop
  // projects the scope doesn't touch.
  const { data: allProjectRows } = await supabase
    .from("projects")
    .select("id, name, color, status, start_date, target_date")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .in("status", ["active", "planned"]);
  const scopedProjectIds = new Set(
    tasks.filter((t) => t.project_id).map((t) => t.project_id as string),
  );
  const projectRows = (allProjectRows ?? []).filter((p) =>
    scope.kind === "property"
      ? true
      : scope.kind === "project"
        ? p.id === scope.id
        : scopedProjectIds.has(p.id),
  );
  const tasksByProject = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    if (!t.project_id) continue;
    const list = tasksByProject.get(t.project_id) ?? [];
    list.push(t);
    tasksByProject.set(t.project_id, list);
  }
  const portfolio: PortfolioRow[] = (projectRows ?? []).map((p) => {
    const list = tasksByProject.get(p.id) ?? [];
    const rollup = rollupTasks(list, now);
    const { pace, paceReasons } = paceFor(
      { start_date: p.start_date, target_date: p.target_date },
      rollup,
      now,
    );
    return {
      projectId: p.id,
      name: p.name,
      color: p.color,
      status: p.status,
      startDate: p.start_date,
      targetDate: p.target_date,
      ...rollup,
      pace,
      paceReasons,
    };
  });
  const paceRank: Record<PaceFlag, number> = { at_risk: 0, behind: 1, on_pace: 2 };
  portfolio.sort((a, b) => paceRank[a.pace] - paceRank[b.pace] || b.total - a.total);

  // ── Workload matrix (management only — routes/toolsets enforce that) ─────
  const fourWeeksStart = weekStartOf(now - 3 * WEEK_MS).getTime();
  const byAssignee = new Map<string, WorkloadRow>();
  const rowFor = (userId: string): WorkloadRow => {
    let row = byAssignee.get(userId);
    if (!row) {
      const p = profileById.get(userId);
      row = {
        userId,
        name: p?.full_name ?? "Unknown",
        avatarUrl: p?.avatar_url ?? null,
        open: 0,
        blocked: 0,
        overdue: 0,
        urgent: 0,
        doneByWeek: [0, 0, 0, 0],
        meetingsCount: 0,
        meetingHours: 0,
      };
      byAssignee.set(userId, row);
    }
    return row;
  };
  for (const t of open) {
    if (!t.assignee_id) continue;
    const row = rowFor(t.assignee_id);
    row.open += 1;
    if (t.status === "blocked") row.blocked += 1;
    if (isOverdue(t)) row.overdue += 1;
    if (t.priority === "high" || t.priority === "urgent") row.urgent += 1;
  }
  for (const e of events) {
    if (e.event_type !== "task.status_changed" || e.to !== "done") continue;
    if (!e.event_assignee) continue;
    const ts = new Date(e.received_at).getTime();
    const idx = Math.floor((ts - fourWeeksStart) / WEEK_MS);
    if (idx < 0 || idx > 3) continue;
    rowFor(e.event_assignee).doneByWeek[idx] += 1;
  }

  // Meeting load, last 7 days — attendees who didn't decline, hours from
  // ended meetings only (live meetings have no duration yet). Meetings are
  // property-level, so only the property scope joins them.
  const { data: recentMeetings } =
    scope.kind === "property"
      ? await supabase
          .from("meetings")
          .select("id, started_at, ended_at")
          .eq("property_id", propertyId)
          .gte("started_at", new Date(now - 7 * DAY_MS).toISOString())
      : { data: null };
  if (recentMeetings && recentMeetings.length > 0) {
    const durationByMeeting = new Map(
      recentMeetings.map((m) => [
        m.id,
        m.ended_at && m.started_at
          ? Math.max(
              0,
              new Date(m.ended_at).getTime() - new Date(m.started_at).getTime(),
            )
          : 0,
      ]),
    );
    const { data: attendees } = await supabase
      .from("meeting_attendees")
      .select("meeting_id, user_id, response")
      .in("meeting_id", [...durationByMeeting.keys()]);
    for (const a of attendees ?? []) {
      if (a.response === "declined") continue;
      // Only count people already on the workload board — meeting load is a
      // workload dimension, not a reason to add otherwise idle rows.
      const row = byAssignee.get(a.user_id);
      if (!row) continue;
      row.meetingsCount += 1;
      row.meetingHours +=
        (durationByMeeting.get(a.meeting_id) ?? 0) / (60 * 60 * 1000);
    }
    for (const row of byAssignee.values())
      row.meetingHours = Math.round(row.meetingHours * 10) / 10;
  }

  const workload = [...byAssignee.values()].sort((a, b) => b.open - a.open);

  return {
    snapshot,
    flow,
    attention,
    cycleTime,
    slip,
    portfolio,
    workload,
    generatedAt: new Date().toISOString(),
  };
}

/** The staff-facing slice: own throughput + own attention items, no peers. */
export async function computeMyWeek(
  propertyId: string,
  userId: string,
): Promise<{ myWeek: MyWeek; attention: AttentionItem[] }> {
  const { tasks, events, profileById } = await fetchRaw(propertyId);
  const now = Date.now();

  const mine = tasks.filter((t) => t.assignee_id === userId);
  const myOpen = mine.filter((t) => t.status !== "done");
  const isOverdue = (t: TaskRow) =>
    !!t.due_at && new Date(t.due_at).getTime() < now;

  const firstWeek = weekStartOf(now - 5 * WEEK_MS);
  const doneByWeek = Array.from({ length: 6 }, (_, i) => ({
    label: weekLabel(new Date(firstWeek.getTime() + i * WEEK_MS)),
    done: 0,
  }));
  for (const e of events) {
    if (e.event_type !== "task.status_changed" || e.to !== "done") continue;
    if (e.event_assignee !== userId) continue;
    const idx = Math.floor(
      (new Date(e.received_at).getTime() - firstWeek.getTime()) / WEEK_MS,
    );
    if (idx >= 0 && idx < 6) doneByWeek[idx].done += 1;
  }

  const blockedSince = new Map<string, number>();
  for (const e of events) {
    if (e.event_type === "task.status_changed" && e.to === "blocked" && e.entity_id)
      blockedSince.set(e.entity_id, new Date(e.received_at).getTime());
  }
  const attention: AttentionItem[] = [];
  for (const t of myOpen) {
    const name = profileById.get(userId)?.full_name ?? null;
    if (t.status === "blocked") {
      const since = blockedSince.get(t.id) ?? new Date(t.updated_at).getTime();
      attention.push({
        taskId: t.id,
        title: t.title,
        kind: "blocked",
        priority: t.priority,
        assigneeId: userId,
        assigneeName: name,
        ageDays: Math.max(0, Math.floor((now - since) / DAY_MS)),
      });
    } else if (isOverdue(t)) {
      attention.push({
        taskId: t.id,
        title: t.title,
        kind: "overdue",
        priority: t.priority,
        assigneeId: userId,
        assigneeName: name,
        ageDays: Math.floor((now - new Date(t.due_at!).getTime()) / DAY_MS),
      });
    }
  }
  // Own likely-to-slip flags, judged against the property-wide cycle
  // distribution (a person's own completions are usually too thin a sample).
  const myTaskById = new Map(mine.map((t) => [t.id, t]));
  const { flags: myFlags } = computeSlipFlags(
    myOpen,
    cycleSamples(events, new Map(tasks.map((t) => [t.id, t]))),
    now,
  );
  const listed = new Set(attention.map((a) => a.taskId));
  const myName = profileById.get(userId)?.full_name ?? null;
  for (const f of myFlags) {
    if (listed.has(f.taskId)) continue;
    const t = myTaskById.get(f.taskId);
    if (!t) continue;
    attention.push({
      taskId: t.id,
      title: t.title,
      kind: "likely_to_slip",
      priority: t.priority,
      assigneeId: userId,
      assigneeName: myName,
      ageDays: Math.max(0, Math.floor(f.dueInDays)),
    });
  }
  attention.sort(
    (a, b) =>
      (a.kind === "likely_to_slip" ? 1 : 0) -
        (b.kind === "likely_to_slip" ? 1 : 0) ||
      (a.kind === "likely_to_slip"
        ? a.ageDays - b.ageDays
        : b.ageDays - a.ageDays),
  );

  return {
    myWeek: {
      doneThisWeek: doneByWeek[5].done,
      doneByWeek,
      openTotal: myOpen.length,
      overdueTotal: myOpen.filter(isOverdue).length,
    },
    attention,
  };
}

/* ── Operations: meetings, automation, heartbeat, knowledge ───────────────── */

export type OperationsMetrics = {
  meetings: {
    count: number;
    totalHours: number;
    actionItems: number;
    unownedActionItems: number;
    decisions: number;
  };
  automation: {
    runsByDay: { label: string; succeeded: number; failed: number }[];
    succeeded: number;
    failed: number;
    avgDurationSeconds: number | null;
    topFailing: { workflowId: string; name: string; failures: number; lastError: string | null }[];
  };
  /** workflow_events per day, 14 days — the property's activity heartbeat. */
  eventVolume: { label: string; count: number }[];
  /** Pinned space docs untouched for 60+ days — SOPs going stale. */
  staleSops: { documentId: string; title: string; updatedAt: string }[];
  /** Owner extras — omitted from manager responses by the route. */
  team: { roleCounts: Record<string, number>; pendingInvites: number };
  generatedAt: string;
};

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export async function computeOperationsMetrics(
  propertyId: string,
): Promise<OperationsMetrics> {
  const supabase = createServiceClient();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * DAY_MS).toISOString();

  const [meetingsRes, runsRes, eventsRes, pinsRes, membershipsRes, invitesRes] =
    await Promise.all([
      supabase
        .from("meetings")
        .select("id, started_at, ended_at, meeting_summaries(action_items, decisions)")
        .eq("property_id", propertyId)
        .gte("started_at", sevenDaysAgo),
      supabase
        .from("workflow_runs")
        .select("workflow_id, status, started_at, finished_at, error")
        .eq("property_id", propertyId)
        .eq("is_dry_run", false)
        .gte("started_at", sevenDaysAgo),
      supabase
        .from("workflow_events")
        .select("received_at")
        .eq("property_id", propertyId)
        .gte("received_at", new Date(now - 14 * DAY_MS).toISOString())
        .limit(10000),
      supabase
        .from("space_pinned_resources")
        .select("document_id, document:documents!inner(id, title, updated_at, archived_at, property_id)")
        .eq("document.property_id", propertyId),
      supabase
        .from("memberships")
        .select("role")
        .eq("property_id", propertyId),
      supabase
        .from("invites")
        .select("id, accepted_at, expires_at")
        .eq("property_id", propertyId),
    ]);

  // ── Meetings: cadence + whether extracted commitments have owners ────────
  let totalMs = 0;
  let actionItems = 0;
  let unowned = 0;
  let decisions = 0;
  type SummaryRow = {
    action_items: { text: string; owner: string | null }[] | null;
    decisions: unknown[] | null;
  };
  const meetingRows = (meetingsRes.data ?? []) as unknown as {
    started_at: string;
    ended_at: string | null;
    meeting_summaries: SummaryRow[] | null;
  }[];
  for (const m of meetingRows) {
    if (m.ended_at)
      totalMs += Math.max(
        0,
        new Date(m.ended_at).getTime() - new Date(m.started_at).getTime(),
      );
    for (const s of m.meeting_summaries ?? []) {
      const items = s.action_items ?? [];
      actionItems += items.length;
      unowned += items.filter((i) => !i.owner).length;
      decisions += (s.decisions ?? []).length;
    }
  }

  // ── Automation health: run outcomes by day + worst offenders ─────────────
  const dayStart = (ts: number) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const firstDay = dayStart(now - 6 * DAY_MS);
  const runsByDay = Array.from({ length: 7 }, (_, i) => ({
    label: dayLabel(new Date(firstDay.getTime() + i * DAY_MS)),
    succeeded: 0,
    failed: 0,
  }));
  let succeeded = 0;
  let failed = 0;
  const durations: number[] = [];
  const failuresByWorkflow = new Map<string, { failures: number; lastError: string | null; lastAt: number }>();
  for (const r of runsRes.data ?? []) {
    const idx = Math.floor(
      (dayStart(new Date(r.started_at).getTime()).getTime() - firstDay.getTime()) /
        DAY_MS,
    );
    if (r.status === "succeeded") {
      succeeded += 1;
      if (idx >= 0 && idx < 7) runsByDay[idx].succeeded += 1;
      if (r.finished_at)
        durations.push(
          new Date(r.finished_at).getTime() - new Date(r.started_at).getTime(),
        );
    } else if (r.status === "failed") {
      failed += 1;
      if (idx >= 0 && idx < 7) runsByDay[idx].failed += 1;
      const at = new Date(r.started_at).getTime();
      const entry = failuresByWorkflow.get(r.workflow_id) ?? {
        failures: 0,
        lastError: null,
        lastAt: 0,
      };
      entry.failures += 1;
      if (at >= entry.lastAt) {
        entry.lastAt = at;
        entry.lastError = r.error ?? null;
      }
      failuresByWorkflow.set(r.workflow_id, entry);
    }
  }
  const failingIds = [...failuresByWorkflow.keys()];
  let workflowNames = new Map<string, string>();
  if (failingIds.length > 0) {
    const { data: wfRows } = await supabase
      .from("workflows")
      .select("id, name")
      .in("id", failingIds);
    workflowNames = new Map((wfRows ?? []).map((w) => [w.id, w.name]));
  }
  const topFailing = [...failuresByWorkflow.entries()]
    .map(([workflowId, f]) => ({
      workflowId,
      name: workflowNames.get(workflowId) ?? "Unknown workflow",
      failures: f.failures,
      lastError: f.lastError,
    }))
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 3);

  // ── Activity heartbeat: events per day, 14 days ──────────────────────────
  const hbFirst = dayStart(now - 13 * DAY_MS);
  const eventVolume = Array.from({ length: 14 }, (_, i) => ({
    label: dayLabel(new Date(hbFirst.getTime() + i * DAY_MS)),
    count: 0,
  }));
  for (const e of eventsRes.data ?? []) {
    const idx = Math.floor(
      (dayStart(new Date(e.received_at).getTime()).getTime() - hbFirst.getTime()) /
        DAY_MS,
    );
    if (idx >= 0 && idx < 14) eventVolume[idx].count += 1;
  }

  // ── Stale pinned SOPs ─────────────────────────────────────────────────────
  const staleCutoff = now - 60 * DAY_MS;
  const seen = new Set<string>();
  const staleSops: OperationsMetrics["staleSops"] = [];
  type PinRow = {
    document: {
      id: string;
      title: string;
      updated_at: string;
      archived_at: string | null;
    } | null;
  };
  for (const pin of (pinsRes.data ?? []) as unknown as PinRow[]) {
    const doc = pin.document;
    if (!doc || doc.archived_at || seen.has(doc.id)) continue;
    if (new Date(doc.updated_at).getTime() < staleCutoff) {
      seen.add(doc.id);
      staleSops.push({
        documentId: doc.id,
        title: doc.title || "Untitled",
        updatedAt: doc.updated_at,
      });
    }
  }
  staleSops.sort(
    (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
  );

  // ── Team composition (owner extras) ──────────────────────────────────────
  const roleCounts: Record<string, number> = {};
  for (const m of membershipsRes.data ?? [])
    roleCounts[m.role] = (roleCounts[m.role] ?? 0) + 1;
  const pendingInvites = (invitesRes.data ?? []).filter(
    (i) => !i.accepted_at && new Date(i.expires_at).getTime() > now,
  ).length;

  return {
    meetings: {
      count: meetingRows.length,
      totalHours: Math.round((totalMs / (60 * 60 * 1000)) * 10) / 10,
      actionItems,
      unownedActionItems: unowned,
      decisions,
    },
    automation: {
      runsByDay,
      succeeded,
      failed,
      avgDurationSeconds:
        durations.length > 0
          ? Math.round(
              durations.reduce((a, b) => a + b, 0) / durations.length / 100,
            ) / 10
          : null,
      topFailing,
    },
    eventVolume,
    staleSops: staleSops.slice(0, 10),
    team: { roleCounts, pendingInvites },
    generatedAt: new Date().toISOString(),
  };
}

/* ── Scope strips: the ambient header stats on project/space detail ───────── */

export type ScopeStrip = {
  total: number;
  done: number;
  open: number;
  blocked: number;
  overdue: number;
  completionPct: number;
  /** Project scope only. */
  pace: PaceFlag | null;
  paceReasons: string[];
  targetDate: string | null;
  /** Space scope only — pinned docs untouched 60+ days. */
  staleSops: number | null;
};

export async function computeScopeStrip(
  propertyId: string,
  scope: { kind: "project" | "space"; id: string },
): Promise<ScopeStrip> {
  const supabase = createServiceClient();
  const now = Date.now();
  const column = scope.kind === "project" ? "project_id" : "space_id";

  const { data: taskRows, error } = await supabase
    .from("tasks")
    .select(
      "id, title, status, priority, assignee_id, project_id, space_id, due_at, created_at, updated_at",
    )
    .eq("property_id", propertyId)
    .eq(column, scope.id);
  if (error) throw new Error(`strip tasks query failed: ${error.message}`);
  const rollup = rollupTasks((taskRows ?? []) as TaskRow[], now);

  let pace: PaceFlag | null = null;
  let paceReasons: string[] = [];
  let targetDate: string | null = null;
  let staleSops: number | null = null;

  if (scope.kind === "project") {
    const { data: project } = await supabase
      .from("projects")
      .select("start_date, target_date")
      .eq("id", scope.id)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (project) {
      targetDate = project.target_date;
      const flag = paceFor(project, rollup, now);
      pace = flag.pace;
      paceReasons = flag.paceReasons;
    }
  } else {
    const { data: pins } = await supabase
      .from("space_pinned_resources")
      .select("document:documents!inner(updated_at, archived_at)")
      .eq("space_id", scope.id);
    const cutoff = now - 60 * DAY_MS;
    staleSops = ((pins ?? []) as unknown as {
      document: { updated_at: string; archived_at: string | null } | null;
    }[]).filter(
      (p) =>
        p.document &&
        !p.document.archived_at &&
        new Date(p.document.updated_at).getTime() < cutoff,
    ).length;
  }

  return {
    total: rollup.total,
    done: rollup.done,
    open: rollup.total - rollup.done,
    blocked: rollup.blocked,
    overdue: rollup.overdue,
    completionPct: rollup.completionPct,
    pace,
    paceReasons,
    targetDate,
    staleSops,
  };
}
