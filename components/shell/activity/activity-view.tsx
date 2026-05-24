"use client";

import { useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { useNotifications } from "@/components/shell/use-notifications";
import { ActivityDetail } from "./activity-detail";
import { ActivityHub } from "./activity-hub";

/**
 * Main-content pane of the Activity section.
 *
 * Two states share this pane:
 *   - Default (no `?n=<id>`): the personal activity hub — greeting,
 *     up-next, filterable timeline, your tasks, recent docs.
 *   - Notification selected: the existing master-detail behaviour, which
 *     opens the notification's target (channel, task, or invite) inline.
 *
 * The notification feed itself lives in the secondary sidebar
 * (`ActivitySection`); selecting a row there sets `?n=<id>`.
 */
export function ActivityView({
  propertyId,
  userId,
  userName,
}: {
  propertyId: string;
  userId: string;
  userName: string | null;
}) {
  const selectedId = useSearchParams().get("n");
  const { notifications, unseenCount } = useNotifications(userId);
  const selected = selectedId
    ? (notifications.find((n) => n.id === selectedId) ?? null)
    : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title="Activity"
        icon={<Bell />}
        actions={
          unseenCount > 0 ? (
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              {unseenCount} unread
            </span>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <ActivityDetail propertyId={propertyId} notification={selected} />
        ) : (
          <ActivityHub
            propertyId={propertyId}
            userId={userId}
            userName={userName}
          />
        )}
      </div>
    </div>
  );
}
