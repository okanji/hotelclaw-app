import type { ComponentProps } from "react";
import type { StatusBadge } from "@/components/ui/status-badge";

// Shared formatting for the workflow run surfaces (all-runs, workflow-runs,
// run inspector) — previously duplicated verbatim in each file.

/** Run/step lifecycle status → house StatusBadge tone. */
export const STATUS_TONES: Record<
  string,
  ComponentProps<typeof StatusBadge>["tone"]
> = {
  succeeded: "success",
  failed: "danger",
  filtered: "neutral",
  running: "info",
  queued: "neutral",
  skipped: "neutral",
  waiting: "warning",
  cancelled: "neutral",
};

/** Compact status label color next to the ring in run lists. */
export function runStatusLabelClass(status: string): string {
  switch (status) {
    case "running":
      return "text-info";
    case "succeeded":
      return "text-success";
    case "failed":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms)) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Elapsed between start/end; `pending` is what an unfinished run shows. */
export function formatDuration(
  start: string,
  end: string | null,
  pending = "—",
): string {
  if (!end) return pending;
  const ms = Date.parse(end) - Date.parse(start);
  if (isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
