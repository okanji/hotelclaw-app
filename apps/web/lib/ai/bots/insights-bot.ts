import "server-only";
/**
 * Insights bot — the AI layer over the Insights section (Tier 1).
 *
 * Two entry points:
 *   - `generateInsightsReport()` — the weekly management report. Metrics and
 *     anomalies are computed deterministically (lib/insights/metrics.ts +
 *     anomalies.ts) and injected into the prompt; the bot narrates and
 *     prioritizes but never computes a number itself. Cached one row per
 *     (property, week, audience) with an event-count freshness check.
 *   - `generateInsightsBrief()` — the automatic intelligence strip. Typed
 *     insight cards via structured output from deterministic trend signals;
 *     fingerprint-cached so the model runs only when the numbers move.
 *
 * Role gating is structural: `buildInsightsTools` simply omits the workload
 * tool from staff toolsets — there is no workload data a staff session could
 * coax out of the model, because the tool doesn't exist for it.
 */
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { runBot, tool, z, type ToolSet } from "@/lib/ai/run-bot";
import { samplingParams } from "@/lib/ai/model-settings";
import { createServiceClient } from "@/lib/supabase/server";
import { createNotifications } from "@/lib/notifications/server";
import {
  computeInsightsMetrics,
  weekStartOf,
  type PortfolioRow,
} from "@/lib/insights/metrics";
import { detectAnomalies, type Anomaly } from "@/lib/insights/anomalies";
import { computeTrendSignals, metricsFingerprint } from "@/lib/insights/trends";
import {
  PROPERTY_SCOPE,
  scopeKey,
  type InsightScope,
} from "@/lib/insights/scope";

/** Cheap-tier model for high-volume, low-stakes generations (staff report
 *  variant, one-line risk annotations). */
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type InsightsRole = "owner" | "manager" | "staff";

export function buildInsightsTools(
  propertyId: string,
  role: InsightsRole,
): ToolSet {
  const tools: ToolSet = {
    get_task_flow_metrics: tool({
      description:
        "Open-work snapshot (counts by status + overdue), the 8-week created-vs-completed flow series, and median cycle time. Use for any question about momentum, throughput, or how much work is in flight.",
      inputSchema: z.object({}),
      execute: async () => {
        const m = await computeInsightsMetrics(propertyId);
        return { snapshot: m.snapshot, flow: m.flow, cycleTime: m.cycleTime };
      },
    }),
    get_blocked_and_overdue: tool({
      description:
        "The attention list: blocked tasks with days-blocked, overdue tasks with days-late, and unassigned urgent work — each with assignee name. Use for 'what's stuck', 'what needs attention', or anything about blockers.",
      inputSchema: z.object({}),
      execute: async () => {
        const m = await computeInsightsMetrics(propertyId);
        return { attention: m.attention.slice(0, 25) };
      },
    }),
    get_project_health: tool({
      description:
        "Per-project rollup: totals, done, blocked, overdue, completion %, and a deterministic pace flag (on_pace / behind / at_risk) with the reasons it was flagged. Use for any question about project status or risk. Never recompute risk — narrate the flags.",
      inputSchema: z.object({}),
      execute: async () => {
        const m = await computeInsightsMetrics(propertyId);
        return { portfolio: m.portfolio };
      },
    }),
  };
  if (role !== "staff") {
    tools.get_workload_summary = tool({
      description:
        "Per-person load: open / blocked / overdue / urgent counts and completions per week for the last 4 weeks. Use for staffing, capacity, and who-is-overloaded questions.",
      inputSchema: z.object({}),
      execute: async () => {
        const m = await computeInsightsMetrics(propertyId);
        return { workload: m.workload };
      },
    });
  }
  return tools;
}

const REPORT_PERSONA = [
  "You are the operations analyst for this property (a hotel/restaurant team workspace). You write the weekly management report.",
  "Rules:",
  "- Every number comes from the metrics JSON you are given or from your tools. Never recompute, never invent, never extrapolate beyond the data.",
  "- The anomalies list was computed deterministically. Address every entry — explain it or explicitly call it benign. Do not invent anomalies of your own.",
  "- Risk flags on projects are deterministic. Narrate them and their reasons; never compute risk yourself.",
  "- Write claims, not labels: 'Completion fell 38% while intake held' — never 'Tasks per week'.",
  "- Name people and projects. 'Marco has 3 blocked tasks' beats 'some tasks are blocked'.",
  "- Be decision-oriented and brief. No filler, no restating the obvious.",
].join("\n");

const REPORT_INSTRUCTIONS = [
  "Write this week's management report in markdown with exactly these sections:",
  "## Headline — 2-3 sentences: the single most important thing a manager should know this week.",
  "## Flow — created vs completed, cycle time, what changed.",
  "## At-risk projects — only flagged projects, with their reasons. If none, one sentence saying so.",
  "## People — load imbalances, who is blocked, unassigned urgent work.",
  "## Do this week — at most three actions, each tied to a specific task, person, or project.",
  "Keep the whole report under 350 words.",
].join("\n");

const STAFF_REPORT_INSTRUCTIONS = [
  "Write this week's team update in markdown for the whole staff. Sections:",
  "## This week — what the team shipped, as a shared accomplishment (lead with the completion count).",
  "## Stuck — blocked or overdue work that needs unsticking, by task name.",
  "## Heads up — anything coming due or newly urgent.",
  "Rules: celebrate throughput; talk about the team's work, NEVER compare individuals or rank people; you may name who's blocked on what only as a call for help, not as criticism. Keep it under 150 words.",
].join("\n");

export type InsightReportRow = {
  id: string;
  property_id: string;
  period_start: string;
  period_end: string;
  audience: "management" | "staff";
  summary_md: string;
  anomalies: Anomaly[];
  model: string;
  created_at: string;
};

/** Sunday ending the week that starts on `monday`. */
function periodEnd(monday: Date): string {
  return new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Regenerate only when the week actually moved on — ~10 new task events. */
const FRESHNESS_EVENT_THRESHOLD = 10;

/**
 * Rows written before runBot exposed `ok` may hold the canned apology text
 * instead of a real generation. Treat them as cache misses so they self-heal
 * on the next request instead of being served until someone hits Regenerate.
 */
function isPoisonedText(text: string): boolean {
  return text.startsWith("I hit an error generating");
}

export async function generateInsightsReport(opts: {
  propertyId: string;
  userId: string;
  force?: boolean;
}): Promise<{ report: InsightReportRow; cached: boolean }> {
  const supabase = createServiceClient();
  const monday = weekStartOf(Date.now());
  const period_start = monday.toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("insight_reports")
    .select(
      "id, property_id, period_start, period_end, audience, summary_md, anomalies, model, created_at",
    )
    .eq("property_id", opts.propertyId)
    .eq("period_start", period_start)
    .eq("audience", "management")
    .maybeSingle();

  if (existing && !opts.force && !isPoisonedText(existing.summary_md ?? "")) {
    const { count } = await supabase
      .from("workflow_events")
      .select("id", { count: "exact", head: true })
      .eq("property_id", opts.propertyId)
      .gt("received_at", existing.created_at);
    if ((count ?? 0) < FRESHNESS_EVENT_THRESHOLD) {
      return { report: existing as InsightReportRow, cached: true };
    }
  }

  const metrics = await computeInsightsMetrics(opts.propertyId);
  const anomalies = detectAnomalies(metrics);

  const result = await runBot({
    persona: REPORT_PERSONA,
    scopedTools: buildInsightsTools(opts.propertyId, "manager"),
    messages: [
      {
        role: "user",
        content: [
          REPORT_INSTRUCTIONS,
          "",
          "## This week's metrics (deterministic — your source of truth)",
          "```json",
          JSON.stringify(
            {
              snapshot: metrics.snapshot,
              flow: metrics.flow,
              cycleTime: metrics.cycleTime,
              portfolio: metrics.portfolio,
              workload: metrics.workload,
              attention: metrics.attention.slice(0, 25),
            },
            null,
            2,
          ),
          "```",
          "",
          "## Detected anomalies (address every one)",
          anomalies.length > 0
            ? JSON.stringify(anomalies, null, 2)
            : "(none detected)",
        ].join("\n"),
      },
    ],
    scope: { propertyId: opts.propertyId, userId: opts.userId, surface: "insights" },
    responseGuidelines:
      "Respond with the full markdown report only — no preamble, no sign-off.",
    maxToolSteps: 6,
  });
  // Never cache a failed generation — the apology text would be served as
  // this week's report until the next forced regen. Throw so the route
  // returns a real error and the cron/viewer retries on the next pass.
  if (!result.ok) {
    throw new Error(`report generation failed: ${result.text}`);
  }

  const row = {
    property_id: opts.propertyId,
    period_start,
    period_end: periodEnd(monday),
    audience: "management" as const,
    summary_md: result.text,
    metrics: metrics as unknown as Record<string, unknown>,
    anomalies,
    model: result.trace?.model ?? "unknown",
    trace: result.trace ?? null,
    created_by: opts.userId,
  };

  const { data: saved, error } = await supabase
    .from("insight_reports")
    .upsert(row, { onConflict: "property_id,period_start,audience" })
    .select(
      "id, property_id, period_start, period_end, audience, summary_md, anomalies, model, created_at",
    )
    .single();
  if (error) throw new Error(`failed to save report: ${error.message}`);

  // Staff-audience variant on the cheap tier — same week, same deterministic
  // inputs minus per-person workload (peer comparison never reaches the
  // staff prompt at all). Failure here never blocks the management report.
  try {
    const staffResult = await runBot({
      persona:
        "You write the weekly team update for the whole staff of this property (a hotel/restaurant team workspace). Every number comes from the metrics JSON you are given — never recompute, never invent. Warm but plain; no corporate cheerleading.",
      scopedTools: {},
      modelId: HAIKU_MODEL,
      messages: [
        {
          role: "user",
          content: [
            STAFF_REPORT_INSTRUCTIONS,
            "",
            "## This week's metrics (deterministic — your source of truth)",
            "```json",
            JSON.stringify(
              {
                snapshot: metrics.snapshot,
                flow: metrics.flow,
                cycleTime: metrics.cycleTime,
                attention: metrics.attention.slice(0, 15),
              },
              null,
              2,
            ),
            "```",
          ].join("\n"),
        },
      ],
      scope: {
        propertyId: opts.propertyId,
        userId: opts.userId,
        surface: "insights",
      },
      responseGuidelines:
        "Respond with the full markdown update only — no preamble, no sign-off.",
      maxToolSteps: 1,
    });
    if (!staffResult.ok) {
      throw new Error(`staff variant failed: ${staffResult.text}`);
    }
    await supabase.from("insight_reports").upsert(
      {
        ...row,
        audience: "staff" as const,
        summary_md: staffResult.text,
        model: staffResult.trace?.model ?? HAIKU_MODEL,
        trace: staffResult.trace ?? null,
      },
      { onConflict: "property_id,period_start,audience" },
    );
  } catch (err) {
    console.error("[insights] staff report variant failed", err);
  }

  // Tell owners/managers a fresh briefing landed (skip the person who
  // triggered it — they're looking at it).
  try {
    const { data: managers } = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("property_id", opts.propertyId)
      .in("role", ["owner", "manager"]);
    const headline = extractHeadline(result.text);
    await createNotifications(
      (managers ?? [])
        .filter((m) => m.user_id !== opts.userId)
        .map((m) => ({
          userId: m.user_id,
          propertyId: opts.propertyId,
          type: "briefing" as const,
          payload: {
            periodStart: period_start,
            periodEnd: periodEnd(monday),
            headline,
          },
        })),
    );
  } catch (err) {
    console.error("[insights] briefing notifications failed", err);
  }

  return { report: saved as InsightReportRow, cached: false };
}

/** First ~200 chars of the report's Headline section, for notification subs. */
function extractHeadline(md: string): string {
  const match = md.match(/##\s*Headline[^\n]*\n+([\s\S]*?)(?=\n##|$)/i);
  const text = (match?.[1] ?? md).replace(/[#*_>`]/g, "").trim();
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/* ── At-risk annotations: one Haiku line per flagged project, cached ──────── */

export type ProjectAnnotation = {
  projectId: string;
  note: string;
};

/**
 * One-line AI assessments for behind/at-risk portfolio projects. Cache key
 * is the rollup fingerprint, so a project whose numbers haven't moved never
 * pays for a second generation. Capped at 5 projects per call; each is a
 * single tool-less Haiku turn over the project's deterministic rollup.
 */
export async function annotateAtRiskProjects(
  propertyId: string,
): Promise<ProjectAnnotation[]> {
  const supabase = createServiceClient();
  const metrics = await computeInsightsMetrics(propertyId);
  const flagged = metrics.portfolio
    .filter((p) => p.pace !== "on_pace")
    .slice(0, 5);
  if (flagged.length === 0) return [];

  const cacheKeyFor = (p: PortfolioRow) =>
    `${p.pace}:${p.completionPct}:${p.blocked}:${p.overdue}:${p.total}:${p.targetDate ?? ""}`;

  const { data: cachedRows } = await supabase
    .from("insight_annotations")
    .select("subject_id, cache_key, note")
    .eq("property_id", propertyId)
    .eq("subject_kind", "project")
    .in("subject_id", flagged.map((p) => p.projectId));
  const cached = new Map(
    (cachedRows ?? []).map((r) => [r.subject_id, r]),
  );

  const out: ProjectAnnotation[] = [];
  for (const p of flagged) {
    const key = cacheKeyFor(p);
    const hit = cached.get(p.projectId);
    if (hit && hit.cache_key === key && !isPoisonedText(hit.note ?? "")) {
      out.push({ projectId: p.projectId, note: hit.note });
      continue;
    }
    try {
      const result = await runBot({
        persona:
          "You write one-line risk assessments for project rollups in a hotel team workspace. One sentence, under 25 words, concrete and decision-oriented. Use only the numbers given — never invent.",
        scopedTools: {},
        modelId: HAIKU_MODEL,
        messages: [
          {
            role: "user",
            content: `Project "${p.name}": ${JSON.stringify({
              completionPct: p.completionPct,
              total: p.total,
              done: p.done,
              blocked: p.blocked,
              overdue: p.overdue,
              targetDate: p.targetDate,
              flaggedBecause: p.paceReasons,
            })}. Write the one-line assessment.`,
          },
        ],
        scope: { propertyId, userId: "system", surface: "insights" },
        responseGuidelines: "Respond with the single sentence only.",
        maxToolSteps: 1,
      });
      // A failed generation must not become the cached note — the
      // fingerprint cache would pin the apology until the numbers move.
      if (!result.ok) continue;
      const note = result.text.trim();
      await supabase.from("insight_annotations").upsert(
        {
          property_id: propertyId,
          subject_kind: "project" as const,
          subject_id: p.projectId,
          cache_key: key,
          note,
          model: result.trace?.model ?? HAIKU_MODEL,
        },
        { onConflict: "property_id,subject_kind,subject_id" },
      );
      out.push({ projectId: p.projectId, note });
    } catch (err) {
      console.error("[insights] annotation failed", p.projectId, err);
    }
  }
  return out;
}

/* ── Automatic intelligence briefs: structured insights, not chat ─────────── */

const BRIEF_MODEL = process.env.AI_BOT_MODEL ?? "claude-sonnet-5";

const InsightCardSchema = z.object({
  kind: z.enum(["trend", "risk", "anomaly", "win", "watch"]),
  severity: z.enum(["info", "warning", "critical"]),
  headline: z
    .string()
    .describe(
      "A claim, not a label — 'Completion fell 38% while intake held', never 'Tasks per week'. Max ~90 chars.",
    ),
  detail: z
    .string()
    .describe(
      "1-2 sentences naming the people, tasks, or projects behind the claim.",
    ),
  spark: z
    .enum(["done", "created", "none"])
    .describe(
      "Which real weekly series supports this insight visually. The UI charts the actual data — pick 'none' unless the flow series is genuinely the evidence.",
    ),
  action: z
    .object({
      label: z.string().describe("Imperative, short: 'Unblock freezer repair'."),
      kind: z.enum(["task", "project", "tasks-board", "reports"]),
      id: z
        .string()
        .nullable()
        .describe("The task/project id FROM THE METRICS for task/project kinds; null otherwise."),
    })
    .nullable(),
  evidence: z
    .object({
      quote: z
        .string()
        .describe(
          "A line copied VERBATIM from the chatter-evidence section — the human words behind the risk. Never paraphrase, never invent.",
        ),
      source: z.string().describe("The line's source exactly as given."),
    })
    .nullable()
    .describe(
      "Only for risk/anomaly cards where a chatter line genuinely explains the numbers; null otherwise. Quotes that aren't verbatim are discarded.",
    ),
  basis: z
    .array(z.string())
    .max(4)
    .describe(
      "The ids (s1, s2, …) of the deterministic signals this card rests on — its provenance. Every card cites at least one; unknown ids are discarded.",
    ),
});

const BriefSchema = z.object({
  insights: z
    .array(InsightCardSchema)
    .min(1)
    .max(4)
    .describe("Ranked, most important first. Fewer, sharper insights beat more."),
  summary: z
    .string()
    .describe(
      "2-4 plain-language sentences explaining what this lens's metrics show a manager: the created-vs-completed balance, how much is open and overdue, cycle time movement. One readable paragraph — no bullets, no headlines, only numbers present in the data.",
    ),
});

export type InsightCard = z.infer<typeof InsightCardSchema>;

export type InsightBriefRow = {
  property_id: string;
  scope: string;
  insights: InsightCard[];
  summary: string | null;
  fingerprint: string;
  model: string;
  generated_at: string;
};

const BRIEF_COLUMNS =
  "property_id, scope, insights, summary, fingerprint, model, generated_at";

/** Best-effort per-instance stampede guard for background regenerations. */
const briefInFlight = new Set<string>();

export async function getCachedBrief(
  propertyId: string,
  scope: InsightScope = PROPERTY_SCOPE,
): Promise<InsightBriefRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("insight_briefs")
    .select(BRIEF_COLUMNS)
    .eq("property_id", propertyId)
    .eq("scope", scopeKey(scope))
    .maybeSingle();
  return (data as InsightBriefRow | null) ?? null;
}

/** Human label for the lens — anchors the analyst persona per scope.
 *  Also used by the insights Q&A bot for `(metric · lens)` citations. */
export async function scopeLabel(
  propertyId: string,
  scope: InsightScope,
): Promise<string> {
  const supabase = createServiceClient();
  switch (scope.kind) {
    case "property":
      return "the whole property";
    case "project": {
      const { data } = await supabase
        .from("projects")
        .select("name")
        .eq("id", scope.id)
        .eq("property_id", propertyId)
        .maybeSingle();
      return `the project "${data?.name ?? "Unknown"}" (only its slice of the work)`;
    }
    case "space": {
      const { data } = await supabase
        .from("spaces")
        .select("name")
        .eq("id", scope.id)
        .eq("property_id", propertyId)
        .maybeSingle();
      return `the "${data?.name ?? "Unknown"}" team's slice of the work`;
    }
    case "person": {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", scope.id)
        .maybeSingle();
      return `${data?.full_name ?? "one person"}'s own work (write about their workload supportively — this is a coaching lens for their manager, not a performance review)`;
    }
  }
}

/**
 * Generate (or confirm) an intelligence brief for a scope — the whole
 * property by default, or one project / space (team) / person. Deterministic
 * inputs — scoped metrics, trend signals, anomalies — go in; ranked
 * structured insight cards come out via `Output.object`. The metrics
 * fingerprint short-circuits the model call when the scope's numbers
 * haven't moved.
 */
export async function generateInsightsBrief(opts: {
  propertyId: string;
  scope?: InsightScope;
  force?: boolean;
}): Promise<{ brief: InsightBriefRow | null; cached: boolean }> {
  const supabase = createServiceClient();
  const scope = opts.scope ?? PROPERTY_SCOPE;
  const flightKey = `${opts.propertyId}:${scopeKey(scope)}`;
  if (briefInFlight.has(flightKey)) {
    return { brief: await getCachedBrief(opts.propertyId, scope), cached: true };
  }
  briefInFlight.add(flightKey);
  try {
    const metrics = await computeInsightsMetrics(opts.propertyId, scope);
    const { computeRecurrenceSignals, gatherProjectChatter } = await import(
      "@/lib/insights/recurrence"
    );
    const recurrence = await computeRecurrenceSignals(opts.propertyId, scope);
    // Recurrence is part of what the brief narrates, so its digest extends
    // the fingerprint — a blocker resurfacing regenerates the brief even
    // when the headline numbers haven't moved.
    const fingerprint = `${metricsFingerprint(metrics)}-${recurrence.hash}`;

    const existing = await getCachedBrief(opts.propertyId, scope);
    if (existing && existing.fingerprint === fingerprint && !opts.force) {
      return { brief: existing, cached: true };
    }

    // A scope with no work and no history needs no analyst — write a
    // deterministic "quiet" card instead of paying model latency/cost to
    // say nothing happened. Keeps empty teams/projects loading instantly.
    const isEmpty =
      metrics.snapshot.openTotal === 0 &&
      metrics.attention.length === 0 &&
      metrics.flow.every((w) => w.created === 0 && w.done === 0);
    if (isEmpty) {
      const quiet = {
        property_id: opts.propertyId,
        scope: scopeKey(scope),
        insights: [
          {
            kind: "watch" as const,
            severity: "info" as const,
            headline: "No activity in this lens yet",
            detail:
              "Nothing has been created, completed, or blocked here in the last 8 weeks. Insights start with the first task.",
            spark: "none" as const,
            action: null,
            evidence: null,
            basis: [],
          },
        ],
        summary:
          "There's nothing to read in this lens yet — no open work and no task activity in the last 8 weeks. The charts and this explainer fill in as soon as the first tasks are created.",
        fingerprint,
        model: "deterministic",
        generated_at: new Date().toISOString(),
      };
      const { data: saved, error } = await supabase
        .from("insight_briefs")
        .upsert(quiet, { onConflict: "property_id,scope" })
        .select(BRIEF_COLUMNS)
        .single();
      if (error) throw new Error(`failed to save quiet brief: ${error.message}`);
      return { brief: saved as InsightBriefRow, cached: false };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return { brief: existing, cached: true };
    }

    const trends = computeTrendSignals(metrics);
    const anomalies = detectAnomalies(metrics);
    const lens = await scopeLabel(opts.propertyId, scope);
    // Every deterministic signal gets a stable id so cards can cite their
    // provenance (`basis`) — validated below, like actions and quotes.
    const signalIndex = [
      ...trends.map((s) => ({ kind: "trend" as const, signal: s.signal, evidence: s.evidence })),
      ...recurrence.signals.map((s) => ({ kind: "recurrence" as const, signal: s.signal, evidence: s.evidence })),
      ...anomalies.map((a) => ({ kind: "anomaly" as const, signal: a.metric, evidence: a.evidence })),
    ].map((s, i) => ({ id: `s${i + 1}`, ...s }));
    const signalById = new Map(signalIndex.map((s) => [s.id, s]));
    // Chatter is mined ONLY for projects the deterministic pace flags
    // already marked — the gate that keeps the cost model intact.
    const flagged = metrics.portfolio.filter((p) => p.pace !== "on_pace");
    const chatter =
      scope.kind === "person"
        ? []
        : await gatherProjectChatter(opts.propertyId, flagged);

    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await generateText({
      model: anthropic(BRIEF_MODEL),
      output: Output.object({ schema: BriefSchema }),
      ...samplingParams(BRIEF_MODEL, 0),
      maxRetries: 3,
      system: [
        `You are the operations analyst for a hotel/restaurant team workspace. You are analyzing ${lens}. Turn its metrics into at most 4 ranked insight cards a manager acts on.`,
        "Rules:",
        "- Every number and name comes from the provided data. Never invent, never extrapolate.",
        "- The trend signals and anomalies were computed deterministically — they are your candidate insights. Rank the ones that matter; drop the noise. Do not derive trends of your own.",
        "- Headlines are claims with numbers, not labels.",
        "- Prefer one critical insight over four mild ones. A quiet week is a 'win' or 'watch' card saying so.",
        "- action.id must be an exact task or project id from the metrics JSON; otherwise use kind 'tasks-board' or 'reports' with id null.",
        "- `summary` explains the charts to a manager skimming them: what the flow balance, open/overdue counts, and cycle time actually mean this week, in plain words. It complements the cards — don't repeat their headlines.",
        "- Recurrence signals are deterministic and high-value — a blocker resurfacing for the Nth time usually outranks a one-week wobble.",
        "- `basis` lists the ids of the signals a card rests on — its provenance, shown to the user. Cite the genuine inputs, nothing decorative.",
        "- `evidence` may quote AT MOST one chatter line per card, copied verbatim with its source, and only when it genuinely explains a flagged risk. Quotes that don't match a provided line exactly are discarded server-side. Most cards have evidence: null.",
      ].join("\n"),
      prompt: [
        "## Metrics (source of truth)",
        JSON.stringify(
          {
            snapshot: metrics.snapshot,
            flow: metrics.flow,
            cycleTime: metrics.cycleTime,
            attention: metrics.attention.slice(0, 15),
            portfolio: metrics.portfolio,
            workload: metrics.workload,
          },
          null,
          2,
        ),
        "",
        "## Deterministic signals (your candidates — cite ids in `basis`)",
        signalIndex.length > 0 ? JSON.stringify(signalIndex, null, 2) : "(none)",
        "",
        "## Chatter evidence (verbatim lines from flagged projects' channels and meetings — quotable, never paraphrasable)",
        chatter.length > 0 ? JSON.stringify(chatter, null, 2) : "(none)",
      ].join("\n"),
    });

    // Guard the deep links: strip actions whose id isn't actually in the
    // data the model was shown. Guard the quotes the same way: an evidence
    // quote must match a supplied chatter line verbatim (whitespace-
    // normalized), and the SOURCE is taken from the matching line, not the
    // model — a paraphrase or invention becomes evidence: null.
    const taskIds = new Set(metrics.attention.map((a) => a.taskId));
    const projectIds = new Set(metrics.portfolio.map((p) => p.projectId));
    const squash = (s: string) => s.replace(/\s+/g, " ").trim();
    const insights = result.output.insights.map((card) => {
      let next = card;
      if (next.action && next.action.id !== null) {
        const valid =
          (next.action.kind === "task" && taskIds.has(next.action.id)) ||
          (next.action.kind === "project" && projectIds.has(next.action.id));
        if (!valid)
          next = {
            ...next,
            action: { ...next.action, kind: "tasks-board" as const, id: null },
          };
      }
      if (next.evidence) {
        const quoted = squash(next.evidence.quote);
        const match = chatter.find(
          (l) => squash(l.quote) === quoted || squash(l.quote).includes(quoted),
        );
        next = match
          ? { ...next, evidence: { quote: match.quote, source: match.source } }
          : { ...next, evidence: null };
      }
      // Resolve basis ids to the human-readable evidence lines (and drop
      // anything the model invented) — what's stored is what's shown.
      next = {
        ...next,
        basis: (next.basis ?? [])
          .map((id) => signalById.get(id)?.evidence)
          .filter((e): e is string => Boolean(e))
          .slice(0, 4),
      };
      return next;
    });

    const row = {
      property_id: opts.propertyId,
      scope: scopeKey(scope),
      insights,
      summary: result.output.summary,
      fingerprint,
      model: result.response?.modelId ?? BRIEF_MODEL,
      generated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase
      .from("insight_briefs")
      .upsert(row, { onConflict: "property_id,scope" })
      .select(BRIEF_COLUMNS)
      .single();
    if (error) throw new Error(`failed to save brief: ${error.message}`);
    return { brief: saved as InsightBriefRow, cached: false };
  } finally {
    briefInFlight.delete(flightKey);
  }
}
