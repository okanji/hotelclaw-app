"use client";

import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { useNotifications } from "@/components/shell/use-notifications";
import { ActivityFeed } from "./activity-hub";
import { viewDef, viewFromParam } from "./views";

/**
 * Activity main pane — the inbox feed. The active view comes from `?view=`
 * (set by the sidebar's filter nav); the header reflects it, the body lists
 * its rows. There's no separate detail pane: clicking a row navigates to the
 * thing it points at, so the sidebar (which slice) and this pane (the rows)
 * each have exactly one job and never duplicate each other.
 */
export function ActivityView({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const view = viewFromParam(useSearchParams().get("view"));
  const def = viewDef(view);
  const Icon = def.icon;
  const { unseenCount } = useNotifications(userId);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        title={view === "inbox" ? "Activity" : def.label}
        icon={<Icon />}
        actions={
          unseenCount > 0 ? (
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {unseenCount} unread
            </span>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ActivityFeed propertyId={propertyId} userId={userId} view={view} />
      </div>
    </div>
  );
}
