"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import {
  ActivityLogList,
  useActivityLogRealtime,
  useActivityLookup,
} from "@/components/activity/activity-log";
import { WidgetEmpty } from "../editorial-section";

const LIMIT = 8;

/**
 * What changed across the property, and who changed it — the last few rows
 * of `activity_log` (migration 0106). The "Recent activity" widget above it
 * is the viewer's own notifications; this one is everyone's work, so a
 * manager opening Home sees the team moving without visiting each project.
 */
export function WorkspaceActivityWidget({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const lookup = useActivityLookup(propertyId, userId);
  useActivityLogRealtime(propertyId);
  const { data: rows = [], isPending } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "property" }, LIMIT),
  );

  if (isPending && rows.length === 0)
    return <WidgetEmpty>Loading activity…</WidgetEmpty>;
  if (rows.length === 0)
    return (
      <WidgetEmpty>
        Nothing has changed yet — task and project updates will show here with
        who made them.
      </WidgetEmpty>
    );

  return (
    <div className="flex flex-col gap-2">
      <ActivityLogList rows={rows} lookup={lookup} showProject />
      <Link
        href={`/p/${propertyId}/activity?view=workspace`}
        className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        See all workspace activity →
      </Link>
    </div>
  );
}
