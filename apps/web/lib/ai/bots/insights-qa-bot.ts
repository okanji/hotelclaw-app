import "server-only";
/**
 * Insights Q&A bot — "Ask the numbers" (Tier 1, insights surface).
 *
 * Conversational layer over the SAME deterministic metric functions the
 * Insights charts render. Every figure in a reply comes from a tool result;
 * the model narrates and cites — it never computes. Tools default to the
 * page's current lens but accept an explicit scope so "what's overdue in
 * housekeeping?" works from the property lens (the model resolves names to
 * ids via `list_lenses` first; ids are validated against the property
 * before any metric call, so a crafted scope can't cross tenants).
 *
 * Stateless by design: the client owns the transcript and posts it whole
 * each turn (the task-bot pattern). Owner/manager only — enforced by the
 * route, and the toolset assumes it.
 */
import { runBot, tool, z, type ModelMessage, type ToolSet } from "@/lib/ai/run-bot";
import { createServiceClient } from "@/lib/supabase/server";
import {
  computeInsightsMetrics,
  computeOperationsMetrics,
} from "@/lib/insights/metrics";
import { parseScope, scopeKey, type InsightScope } from "@/lib/insights/scope";
import { scopeLabel } from "./insights-bot";

/** Parse + tenant-validate a tool's scope arg; fall back to the page lens. */
async function resolveScope(
  propertyId: string,
  pageScope: InsightScope,
  raw: string | undefined,
): Promise<{ scope: InsightScope; lens: string } | { error: string }> {
  const scope = raw ? parseScope(raw) : pageScope;
  if (!scope) {
    return {
      error: `invalid scope "${raw}" — use 'property', 'project:<id>', 'space:<id>', or 'person:<id>' with ids from list_lenses`,
    };
  }
  const supabase = createServiceClient();
  if (scope.kind === "project" || scope.kind === "space") {
    const { data } = await supabase
      .from(scope.kind === "project" ? "projects" : "spaces")
      .select("id")
      .eq("id", scope.id)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (!data) return { error: `${scope.kind} ${scope.id} not found in this property` };
  } else if (scope.kind === "person") {
    const { data } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("property_id", propertyId)
      .eq("user_id", scope.id)
      .maybeSingle();
    if (!data) return { error: `person ${scope.id} is not a member of this property` };
  }
  return { scope, lens: await scopeLabel(propertyId, scope) };
}

function buildQaTools(propertyId: string, pageScope: InsightScope): ToolSet {
  const scopeParam = z
    .string()
    .optional()
    .describe(
      "Lens to compute for: 'property', 'project:<id>', 'space:<id>', or 'person:<id>'. Omit to use the lens the user is currently viewing. Resolve names to ids with list_lenses first.",
    );

  return {
    list_lenses: tool({
      description:
        "The property's projects, teams (spaces), and people with their ids — use this to map a name the user said ('housekeeping', 'Maria') to a scope id before calling a scoped metric tool.",
      inputSchema: z.object({}),
      execute: async () => {
        const supabase = createServiceClient();
        const [projects, spaces, members] = await Promise.all([
          supabase
            .from("projects")
            .select("id, name, status")
            .eq("property_id", propertyId)
            .is("archived_at", null),
          supabase
            .from("spaces")
            .select("id, name")
            .eq("property_id", propertyId)
            .is("archived_at", null),
          supabase
            .from("memberships")
            .select("user_id, role")
            .eq("property_id", propertyId),
        ]);
        const userIds = (members.data ?? []).map((m) => m.user_id);
        const { data: profiles } = userIds.length
          ? await supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", userIds)
          : { data: [] };
        const nameById = new Map(
          (profiles ?? []).map((p) => [p.id, p.full_name]),
        );
        return {
          projects: projects.data ?? [],
          spaces: spaces.data ?? [],
          people: (members.data ?? []).map((m) => ({
            id: m.user_id,
            name: nameById.get(m.user_id) ?? null,
            role: m.role,
          })),
        };
      },
    }),

    get_flow_metrics: tool({
      description:
        "Open-work snapshot (counts by status + overdue), the 8-week created-vs-completed flow series, median cycle time (vs prior month), and the likely-to-slip summary, for a lens. Use for momentum, throughput, backlog, or cycle-time questions.",
      inputSchema: z.object({ scope: scopeParam }),
      execute: async ({ scope: raw }) => {
        const r = await resolveScope(propertyId, pageScope, raw);
        if ("error" in r) return r;
        const m = await computeInsightsMetrics(propertyId, r.scope);
        return {
          lens: r.lens,
          snapshot: m.snapshot,
          flow: m.flow,
          cycleTime: m.cycleTime,
          slip: { count: m.slip.count, sample: m.slip.sample, p75ByCohort: m.slip.p75ByCohort },
        };
      },
    }),

    get_attention: tool({
      description:
        "The attention list for a lens: blocked tasks (days blocked), overdue tasks (days late), likely-to-slip tasks (days of runway left), and unassigned urgent work — each with assignee name and task id. Use for 'what's stuck / overdue / at deadline risk'.",
      inputSchema: z.object({ scope: scopeParam }),
      execute: async ({ scope: raw }) => {
        const r = await resolveScope(propertyId, pageScope, raw);
        if ("error" in r) return r;
        const m = await computeInsightsMetrics(propertyId, r.scope);
        return { lens: r.lens, attention: m.attention.slice(0, 25) };
      },
    }),

    get_portfolio: tool({
      description:
        "Per-project rollups across the property: totals, done, blocked, overdue, completion %, and the deterministic pace flag (on_pace / behind / at_risk) with its reasons. Use for any project-status or risk question. Never recompute risk — narrate the flags.",
      inputSchema: z.object({}),
      execute: async () => {
        const m = await computeInsightsMetrics(propertyId);
        return { lens: "the whole property", portfolio: m.portfolio };
      },
    }),

    get_workload: tool({
      description:
        "Per-person load across the property: open / blocked / overdue / urgent counts, weekly completions, and meeting load. Use for capacity and load-balance questions.",
      inputSchema: z.object({}),
      execute: async () => {
        const m = await computeInsightsMetrics(propertyId);
        return { lens: "the whole property", workload: m.workload };
      },
    }),

    get_operations: tool({
      description:
        "Property operations health, last 7-14 days: meetings/decisions/unowned action items, automation run successes and failures, daily event volume, and stale pinned SOPs. Property lens only.",
      inputSchema: z.object({}),
      execute: async () => {
        const m = await computeOperationsMetrics(propertyId);
        return {
          lens: "the whole property",
          meetings: m.meetings,
          automation: {
            succeeded: m.automation.succeeded,
            failed: m.automation.failed,
            topFailing: m.automation.topFailing,
          },
          staleSops: m.staleSops,
        };
      },
    }),

    get_weekly_report: tool({
      description:
        "The latest AI weekly management report (markdown) with its period and the anomalies it addressed. Use when the user asks what the report said or wants last week's narrative.",
      inputSchema: z.object({}),
      execute: async () => {
        const supabase = createServiceClient();
        const { data } = await supabase
          .from("insight_reports")
          .select("period_start, period_end, summary_md, anomalies")
          .eq("property_id", propertyId)
          .eq("audience", "management")
          .order("period_start", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data ?? { report: null, note: "no weekly report generated yet" };
      },
    }),
  };
}

/* ── Pinned prompts: fingerprint-cached Q&A answers ───────────────────────── */

export type InsightPromptRow = {
  id: string;
  property_id: string;
  user_id: string;
  prompt: string;
  scope: string;
  answer_md: string | null;
  fingerprint: string | null;
  generated_at: string | null;
};

const PROMPT_COLUMNS =
  "id, property_id, user_id, prompt, scope, answer_md, fingerprint, generated_at";

const promptInFlight = new Set<string>();

/**
 * Refresh one pinned prompt — the ClickUp-Brain-card economics done right:
 * the answer regenerates only when the lens's metrics fingerprint moved
 * (or `force`), so an unchanging board costs zero model calls no matter how
 * often the page is opened. Failed generations never overwrite a cached
 * answer.
 */
export async function refreshPinnedPrompt(
  row: InsightPromptRow,
  opts?: { force?: boolean },
): Promise<InsightPromptRow> {
  if (promptInFlight.has(row.id)) return row;
  promptInFlight.add(row.id);
  try {
    const scope = parseScope(row.scope) ?? { kind: "property" as const };
    const supabase = createServiceClient();
    const { computeInsightsMetrics: compute } = await import(
      "@/lib/insights/metrics"
    );
    const { metricsFingerprint } = await import("@/lib/insights/trends");
    const metrics = await compute(row.property_id, scope);
    const fingerprint = metricsFingerprint(metrics);
    if (row.fingerprint === fingerprint && row.answer_md && !opts?.force) {
      return row;
    }

    const result = await runInsightsQaBot({
      propertyId: row.property_id,
      userId: row.user_id,
      scope,
      messages: [{ role: "user", content: row.prompt }],
    });
    if (!result.ok) return row;

    const { data: saved, error } = await supabase
      .from("insight_prompts")
      .update({
        answer_md: result.text.trim(),
        fingerprint,
        generated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select(PROMPT_COLUMNS)
      .single();
    if (error) {
      console.error("[insight-prompts] save failed", row.id, error.message);
      return row;
    }
    return saved as InsightPromptRow;
  } finally {
    promptInFlight.delete(row.id);
  }
}

export async function runInsightsQaBot(opts: {
  propertyId: string;
  userId: string;
  scope: InsightScope;
  messages: ModelMessage[];
}) {
  const lens = await scopeLabel(opts.propertyId, opts.scope);
  const persona = [
    `You are the operations analyst for a hotel/restaurant team workspace, answering questions about this property's numbers. The user is currently viewing the Insights page through the lens of ${lens} (scope key: ${scopeKey(opts.scope)}) — scoped tools default to that lens.`,
    "Hard rules:",
    "- Every figure and name in your reply comes from a tool result. Never compute, never extrapolate, never fill gaps from memory.",
    "- After each figure or claim, cite its source as (tool-subject · lens), e.g. \"(attention · Housekeeping team)\" or \"(flow · the whole property)\". Tools return the lens label to cite.",
    "- Pace flags and likely-to-slip flags are deterministic. Narrate them and their reasons; never re-derive risk yourself.",
    "- When the user names a project, team, or person, resolve it with list_lenses before calling a scoped tool with that id.",
    "- If the data shows nothing (empty lists, zeroes), say so plainly. No invented context.",
    "- Be concise: lead with the answer, then the supporting numbers. Use a short list only when comparing several items.",
  ].join("\n");

  return runBot({
    persona,
    scopedTools: buildQaTools(opts.propertyId, opts.scope),
    messages: opts.messages,
    maxToolSteps: 6,
    scope: {
      propertyId: opts.propertyId,
      userId: opts.userId,
      surface: "insights",
    },
  });
}
