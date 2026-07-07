import "server-only";
/**
 * Deterministic anomaly detection — computed BEFORE the report bot runs and
 * injected into its prompt as input it must address. The bot never discovers
 * anomalies itself; with 8 weekly data points, honest ±40%-vs-trailing-mean
 * rules beat any pretense of statistics.
 */
import type { InsightsMetrics } from "./metrics";

export type Anomaly = {
  metric: string;
  direction: "up" | "down";
  /** e.g. 1.6 = 60% above the trailing mean. */
  magnitude: number;
  evidence: string;
};

const THRESHOLD = 0.4;

function compare(
  metric: string,
  thisWeek: number,
  trailing: number[],
  out: Anomaly[],
) {
  const mean = trailing.reduce((a, b) => a + b, 0) / trailing.length;
  // A quiet history makes every ratio explode — require a real baseline.
  if (mean < 1) return;
  const ratio = thisWeek / mean;
  if (ratio > 1 + THRESHOLD || ratio < 1 - THRESHOLD) {
    out.push({
      metric,
      direction: ratio > 1 ? "up" : "down",
      magnitude: Math.round(ratio * 100) / 100,
      evidence: `${thisWeek} this week vs ${Math.round(mean * 10) / 10}/wk trailing 4-week mean`,
    });
  }
}

/** Compare the current week against the trailing 4-week mean. */
export function detectAnomalies(metrics: InsightsMetrics): Anomaly[] {
  const out: Anomaly[] = [];
  const flow = metrics.flow;
  if (flow.length < 5) return out;
  const current = flow[flow.length - 1];
  const trailing = flow.slice(-5, -1);
  compare(
    "tasks_created",
    current.created,
    trailing.map((w) => w.created),
    out,
  );
  compare(
    "tasks_completed",
    current.done,
    trailing.map((w) => w.done),
    out,
  );
  return out;
}
