import "server-only";
/**
 * Deterministic trend signals — computed in code and handed to the brief
 * generator as input. The model ranks and narrates these; it never derives
 * a trend itself. Same philosophy as `anomalies.ts`: with 8 weekly points,
 * honest deltas and streaks beat statistical theater.
 */
import type { InsightsMetrics } from "./metrics";

export type TrendSignal = {
  signal: string;
  evidence: string;
};

/** ≥3 consecutive weekly moves in the same direction. */
function streak(values: number[]): { direction: "up" | "down"; length: number } | null {
  let dir: "up" | "down" | null = null;
  let len = 0;
  for (let i = values.length - 1; i > 0; i--) {
    const step = values[i] - values[i - 1];
    if (step === 0) break;
    const stepDir = step > 0 ? "up" : "down";
    if (dir === null) dir = stepDir;
    if (stepDir !== dir) break;
    len += 1;
  }
  return dir && len >= 3 ? { direction: dir, length: len } : null;
}

export function computeTrendSignals(metrics: InsightsMetrics): TrendSignal[] {
  const out: TrendSignal[] = [];
  const flow = metrics.flow;
  if (flow.length >= 2) {
    const cur = flow[flow.length - 1];
    const prev = flow[flow.length - 2];

    if (prev.done > 0 || cur.done > 0) {
      out.push({
        signal: "completion_week_over_week",
        evidence: `completed ${cur.done} this week vs ${prev.done} last week`,
      });
    }
    if (prev.created > 0 || cur.created > 0) {
      out.push({
        signal: "intake_week_over_week",
        evidence: `created ${cur.created} this week vs ${prev.created} last week`,
      });
    }

    const recent = flow.slice(-4);
    const netFlow = recent.reduce((a, w) => a + w.created - w.done, 0);
    if (netFlow !== 0) {
      out.push({
        signal: netFlow > 0 ? "backlog_growing" : "backlog_shrinking",
        evidence: `${Math.abs(netFlow)} ${netFlow > 0 ? "more created than completed" : "more completed than created"} over the last 4 weeks`,
      });
    }

    const doneStreak = streak(flow.map((w) => w.done));
    if (doneStreak) {
      out.push({
        signal: `completion_streak_${doneStreak.direction}`,
        evidence: `completions have moved ${doneStreak.direction} ${doneStreak.length} weeks in a row`,
      });
    }
  }

  const agedBlocked = metrics.attention.filter(
    (a) => a.kind === "blocked" && a.ageDays >= 7,
  );
  if (agedBlocked.length > 0) {
    out.push({
      signal: "blocked_aging",
      evidence: `${agedBlocked.length} task(s) blocked 7+ days, oldest "${agedBlocked[0].title}" at ${agedBlocked[0].ageDays}d`,
    });
  }

  const slipping = metrics.attention.filter((a) => a.kind === "likely_to_slip");
  if (slipping.length > 0) {
    out.push({
      signal: "slip_risk",
      evidence: `${slipping.length} task(s) due inside the typical completion time (p75 of ${metrics.slip.sample} completed tasks); tightest "${slipping[0].title}" due in ${slipping[0].ageDays}d`,
    });
  }

  const unassignedUrgent = metrics.attention.filter(
    (a) => a.kind === "unassigned_urgent",
  );
  if (unassignedUrgent.length > 0) {
    out.push({
      signal: "urgent_unowned",
      evidence: `${unassignedUrgent.length} high/urgent task(s) have no assignee`,
    });
  }

  const flagged = metrics.portfolio.filter((p) => p.pace !== "on_pace");
  for (const p of flagged.slice(0, 3)) {
    out.push({
      signal: `project_${p.pace}`,
      evidence: `"${p.name}": ${p.paceReasons.join("; ")}`,
    });
  }

  // Load imbalance: someone carrying 2x+ the median open count.
  const opens = metrics.workload.map((w) => w.open).sort((a, b) => a - b);
  if (opens.length >= 2) {
    const median = opens[Math.floor(opens.length / 2)];
    const top = metrics.workload[0];
    if (median > 0 && top.open >= median * 2 && top.open >= 5) {
      out.push({
        signal: "load_imbalance",
        evidence: `${top.name} carries ${top.open} open tasks vs a median of ${median}`,
      });
    }
  }

  if (metrics.cycleTime.medianDays !== null && metrics.cycleTime.prevMedianDays !== null) {
    const delta = metrics.cycleTime.medianDays - metrics.cycleTime.prevMedianDays;
    if (Math.abs(delta) >= 1) {
      out.push({
        signal: delta > 0 ? "cycle_time_slowing" : "cycle_time_improving",
        evidence: `median cycle time ${metrics.cycleTime.medianDays}d vs ${metrics.cycleTime.prevMedianDays}d the prior month`,
      });
    }
  }

  return out;
}

/**
 * Stable fingerprint of the numbers a brief is written from. When this
 * doesn't change, the cached brief is still true and no model call happens.
 */
export function metricsFingerprint(metrics: InsightsMetrics): string {
  const key = JSON.stringify({
    s: metrics.snapshot.byStatus.map((s) => [s.status, s.count, s.overdue]),
    f: metrics.flow.slice(-2).map((w) => [w.created, w.done]),
    a: metrics.attention.slice(0, 12).map((a) => [a.taskId, a.kind, a.ageDays >= 7]),
    p: metrics.portfolio.map((p) => [p.projectId, p.pace, p.completionPct]),
    w: metrics.workload.map((w) => [w.userId, w.open, w.blocked, w.overdue]),
  });
  // djb2 — tiny, stable, good enough for change detection.
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
