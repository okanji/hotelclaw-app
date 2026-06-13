import "server-only";
/**
 * Transition alerts — deterministic, edge-triggered. The 10-minute
 * sweep-overdue cron calls `sweepInsightAlerts()`; each property is actually
 * evaluated at most once per hour (the `meta` row in `insight_alert_state`
 * is the throttle). One `computeInsightsMetrics` call per evaluated
 * property; the diff against stored state decides what fires:
 *
 *   project pace  → at_risk   notifies the property's owners/managers
 *   task runway < typical p75 notifies the assignee (managers when the
 *                              task is unassigned or urgent/high)
 *
 * State rows are upserted on every change — including downgrades — so a
 * later re-flip alerts again. `findAlreadyNotifiedUserIds` (24h window) is
 * belt-and-suspenders on top of the edge detection.
 */
import { createServiceClient } from "@/lib/supabase/server";
import {
  createNotifications,
  findAlreadyNotifiedUserIds,
} from "@/lib/notifications/server";
import { computeInsightsMetrics } from "./metrics";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

type StateRow = {
  property_id: string;
  subject_kind: "project_pace" | "task_slip" | "meta";
  subject_id: string;
  state: string;
};

export async function sweepInsightAlerts(): Promise<{
  checked: number;
  alerts: number;
}> {
  const supabase = createServiceClient();
  const { data: properties, error } = await supabase
    .from("properties")
    .select("id")
    .is("archived_at", null);
  if (error) throw new Error(`properties query failed: ${error.message}`);

  let checked = 0;
  let alerts = 0;
  for (const property of properties ?? []) {
    try {
      const fired = await sweepProperty(property.id);
      if (fired === null) continue; // throttled
      checked += 1;
      alerts += fired;
    } catch (err) {
      console.error("[insight-alerts] property failed", property.id, err);
    }
  }
  return { checked, alerts };
}

/** Returns the number of alerts fired, or null when throttled. */
async function sweepProperty(propertyId: string): Promise<number | null> {
  const supabase = createServiceClient();
  const { data: stateRows } = await supabase
    .from("insight_alert_state")
    .select("property_id, subject_kind, subject_id, state")
    .eq("property_id", propertyId);
  const states = (stateRows ?? []) as StateRow[];

  const meta = states.find((s) => s.subject_kind === "meta");
  if (meta && Date.now() - new Date(meta.state).getTime() < CHECK_INTERVAL_MS) {
    return null;
  }

  const metrics = await computeInsightsMetrics(propertyId);
  const upserts: StateRow[] = [
    {
      property_id: propertyId,
      subject_kind: "meta",
      subject_id: propertyId,
      state: new Date().toISOString(),
    },
  ];
  let fired = 0;

  // ── Project pace flips ───────────────────────────────────────────────────
  const paceState = new Map(
    states
      .filter((s) => s.subject_kind === "project_pace")
      .map((s) => [s.subject_id, s.state]),
  );
  // Missing prior state counts as a transition — a project that is at risk
  // the first time we ever look deserves the alert too (one-time on rollout;
  // the 24h notified-window guards repeats).
  const flipped = metrics.portfolio.filter(
    (p) => p.pace === "at_risk" && paceState.get(p.projectId) !== "at_risk",
  );
  for (const p of metrics.portfolio) {
    if (paceState.get(p.projectId) !== p.pace) {
      upserts.push({
        property_id: propertyId,
        subject_kind: "project_pace",
        subject_id: p.projectId,
        state: p.pace,
      });
    }
  }
  if (flipped.length > 0) {
    const managerIds = await loadManagerIds(propertyId);
    for (const p of flipped) {
      const already = await findAlreadyNotifiedUserIds({
        userIds: managerIds,
        type: "project_at_risk",
        match: { key: "projectId", value: p.projectId },
      });
      const targets = managerIds.filter((id) => !already.has(id));
      await createNotifications(
        targets.map((userId) => ({
          userId,
          propertyId,
          type: "project_at_risk" as const,
          payload: {
            projectId: p.projectId,
            name: p.name,
            reasons: p.paceReasons,
          },
        })),
      );
      fired += targets.length;
    }
  }

  // ── Task slip crossings ──────────────────────────────────────────────────
  const slipState = new Map(
    states
      .filter((s) => s.subject_kind === "task_slip")
      .map((s) => [s.subject_id, s.state]),
  );
  const slipAttention = new Map(
    metrics.attention
      .filter((a) => a.kind === "likely_to_slip")
      .map((a) => [a.taskId, a]),
  );
  const newlyFlagged = metrics.slip.flags.filter(
    (f) => slipState.get(f.taskId) !== "flagged" && slipAttention.has(f.taskId),
  );
  for (const f of metrics.slip.flags) {
    if (slipState.get(f.taskId) !== "flagged") {
      upserts.push({
        property_id: propertyId,
        subject_kind: "task_slip",
        subject_id: f.taskId,
        state: "flagged",
      });
    }
  }
  // Re-arm cleared flags so a later re-crossing alerts again.
  const flaggedNow = new Set(metrics.slip.flags.map((f) => f.taskId));
  for (const [taskId, state] of slipState) {
    if (state === "flagged" && !flaggedNow.has(taskId)) {
      upserts.push({
        property_id: propertyId,
        subject_kind: "task_slip",
        subject_id: taskId,
        state: "clear",
      });
    }
  }
  if (newlyFlagged.length > 0) {
    const managerIds = await loadManagerIds(propertyId);
    for (const f of newlyFlagged) {
      const item = slipAttention.get(f.taskId)!;
      const escalate =
        !item.assigneeId ||
        item.priority === "urgent" ||
        item.priority === "high";
      const targetIds = [
        ...(item.assigneeId ? [item.assigneeId] : []),
        ...(escalate ? managerIds : []),
      ].filter((id, i, xs) => xs.indexOf(id) === i);
      const already = await findAlreadyNotifiedUserIds({
        userIds: targetIds,
        type: "task_slip",
        match: { key: "taskId", value: f.taskId },
      });
      const targets = targetIds.filter((id) => !already.has(id));
      await createNotifications(
        targets.map((userId) => ({
          userId,
          propertyId,
          type: "task_slip" as const,
          payload: {
            taskId: f.taskId,
            title: item.title,
            dueInDays: f.dueInDays,
            p75Days: f.p75Days,
          },
        })),
      );
      fired += targets.length;
    }
  }

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("insight_alert_state")
      .upsert(upserts, { onConflict: "property_id,subject_kind,subject_id" });
    if (error)
      console.error("[insight-alerts] state upsert failed", error.message);
  }

  return fired;
}

async function loadManagerIds(propertyId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("property_id", propertyId)
    .in("role", ["owner", "manager"]);
  return (data ?? []).map((m) => m.user_id as string);
}

/* ── User-defined threshold rules (edge-triggered, daily) ─────────────────── */

export type AlertRuleMetric =
  | "overdue_count"
  | "blocked_count"
  | "unassigned_urgent_count"
  | "project_at_risk";

export const ALERT_METRIC_LABEL: Record<AlertRuleMetric, string> = {
  overdue_count: "Overdue tasks",
  blocked_count: "Blocked tasks",
  unassigned_urgent_count: "Unassigned urgent tasks",
  project_at_risk: "Project flips to at risk",
};

type RuleRow = {
  id: string;
  user_id: string;
  scope: string;
  metric: AlertRuleMetric;
  threshold: number | null;
  last_state: { firing?: boolean; value?: number; at?: string };
};

/**
 * Evaluate a property's enabled alert rules — called from the refresh-briefs
 * cron (daily), BEFORE its quiet-property skip. One `computeInsightsMetrics`
 * per distinct rule scope; a rule fires on the false→true transition only
 * (stored `last_state`), re-arming when the condition clears, so a stuck
 * condition emails once, not daily. Fires the in-app `insight_alert`
 * notification and the email together so the channels can't diverge.
 */
export async function evaluateAlertRules(propertyId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data: rules } = await supabase
    .from("insight_alert_rules")
    .select("id, user_id, scope, metric, threshold, last_state")
    .eq("property_id", propertyId)
    .eq("enabled", true);
  if (!rules || rules.length === 0) return 0;

  // Lazy imports keep alerts.ts free of a hard email/bot dependency for the
  // sweep path (which never emails).
  const [{ parseScope }, { scopeLabel }, { sendAlertEmail }, { getOrigin }] =
    await Promise.all([
      import("./scope"),
      import("@/lib/ai/bots/insights-bot"),
      import("@/lib/email/send-insight-email"),
      import("@/lib/utils/origin"),
    ]);

  const { data: property } = await supabase
    .from("properties")
    .select("name")
    .eq("id", propertyId)
    .maybeSingle();
  const propertyName = property?.name ?? "Your property";

  const byScope = new Map<string, RuleRow[]>();
  for (const r of rules as RuleRow[]) {
    const list = byScope.get(r.scope) ?? [];
    list.push(r);
    byScope.set(r.scope, list);
  }

  let fired = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const [scopeRaw, scopeRules] of byScope) {
    const scope = parseScope(scopeRaw);
    if (!scope) continue;
    let metrics;
    try {
      metrics = await computeInsightsMetrics(propertyId, scope);
    } catch (err) {
      console.error("[insight-alerts] rule metrics failed", scopeRaw, err);
      continue;
    }
    const lens = await scopeLabel(propertyId, scope);

    for (const rule of scopeRules) {
      const value = ruleValue(rule.metric, scope, metrics);
      const firing =
        rule.metric === "project_at_risk"
          ? value > 0
          : value > (rule.threshold ?? 0);
      const was = rule.last_state?.firing === true;

      if (firing && !was) {
        fired += 1;
        const description =
          rule.metric === "project_at_risk"
            ? `Project at risk in ${lens}`
            : `${ALERT_METRIC_LABEL[rule.metric]} > ${rule.threshold ?? 0} in ${lens}`;
        const detailLines = ruleDetailLines(rule.metric, metrics);
        await createNotifications([
          {
            userId: rule.user_id,
            propertyId,
            type: "insight_alert",
            payload: {
              scope: scopeRaw,
              scopeLabel: lens,
              metric: rule.metric,
              value,
              threshold: rule.threshold,
            },
          },
        ]);
        try {
          const origin = await getOrigin();
          await sendAlertEmail({
            userId: rule.user_id,
            propertyId,
            propertyName,
            dedupeKey: `alert/${rule.id}/${today}`,
            ruleDescription: description,
            currentValue: String(value),
            detailLines,
            insightsUrl: `${origin}/p/${propertyId}/insights`,
          });
        } catch (err) {
          console.error("[insight-alerts] rule email failed", rule.id, err);
        }
      }

      await supabase
        .from("insight_alert_rules")
        .update({
          last_state: { firing, value, at: new Date().toISOString() },
          ...(firing && !was
            ? { last_triggered_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", rule.id);
    }
  }
  return fired;
}

function ruleValue(
  metric: AlertRuleMetric,
  scope: { kind: string; id?: string },
  metrics: Awaited<ReturnType<typeof computeInsightsMetrics>>,
): number {
  switch (metric) {
    case "overdue_count":
      return metrics.snapshot.overdueTotal;
    case "blocked_count":
      return (
        metrics.snapshot.byStatus.find((s) => s.status === "blocked")?.count ?? 0
      );
    case "unassigned_urgent_count":
      return metrics.attention.filter((a) => a.kind === "unassigned_urgent")
        .length;
    case "project_at_risk": {
      if (scope.kind === "project") {
        const row = metrics.portfolio.find((p) => p.projectId === scope.id);
        return row?.pace === "at_risk" ? 1 : 0;
      }
      return metrics.portfolio.filter((p) => p.pace === "at_risk").length;
    }
  }
}

function ruleDetailLines(
  metric: AlertRuleMetric,
  metrics: Awaited<ReturnType<typeof computeInsightsMetrics>>,
): string[] {
  if (metric === "project_at_risk") {
    return metrics.portfolio
      .filter((p) => p.pace === "at_risk")
      .slice(0, 5)
      .map((p) => `${p.name}: ${p.paceReasons.join("; ")}`);
  }
  const kind =
    metric === "overdue_count"
      ? "overdue"
      : metric === "blocked_count"
        ? "blocked"
        : "unassigned_urgent";
  return metrics.attention
    .filter((a) => a.kind === kind)
    .slice(0, 5)
    .map(
      (a) =>
        `${a.title}${a.assigneeName ? ` — ${a.assigneeName}` : ""} (${
          kind === "unassigned_urgent" ? a.priority : `${a.ageDays}d`
        })`,
    );
}
