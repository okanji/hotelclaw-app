"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import {
  ActivityLogList,
  useActivityLogRealtime,
  useActivityLookup,
  useViewerId,
} from "./activity-log";

const COLLAPSED = 6;

/**
 * Field-change history for one task — who moved it, re-prioritised it,
 * reassigned it, rescheduled it — read from `activity_log` (migration 0106).
 * Sits in the task page's Activity section above the comment threads, which
 * stay Liveblocks. The creation row is excluded: the page already renders
 * "Task created by X" from the task itself (it predates the log).
 */
export function TaskHistory({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const meId = useViewerId();
  const lookup = useActivityLookup(propertyId, meId);
  useActivityLogRealtime(propertyId);
  const { data: rows = [] } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "task", id: taskId }, 100),
  );
  const [expanded, setExpanded] = useState(false);

  const history = rows.filter((r) => r.verb !== "created");
  if (history.length === 0) return null;
  const shown = expanded ? history : history.slice(0, COLLAPSED);

  return (
    <div className="mb-4">
      <ActivityLogList rows={shown} lookup={lookup} dense />
      {history.length > COLLAPSED ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Show less" : `Show ${history.length - COLLAPSED} earlier changes`}
        </button>
      ) : null}
    </div>
  );
}
