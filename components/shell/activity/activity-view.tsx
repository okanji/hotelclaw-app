"use client";

import { useSearchParams } from "next/navigation";
import { useNotifications } from "@/components/shell/use-notifications";
import { ActivityDetail } from "./activity-detail";

/**
 * Main-content pane of the Activity section. The notification feed itself
 * lives in the secondary sidebar (`ActivitySection`); selecting a row there
 * sets `?n=<id>`, and this pane renders that notification's target inline —
 * a chat channel, a task, or an invitation.
 */
export function ActivityView({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const selectedId = useSearchParams().get("n");
  const { notifications } = useNotifications(userId);
  const selected = selectedId
    ? (notifications.find((n) => n.id === selectedId) ?? null)
    : null;

  return <ActivityDetail propertyId={propertyId} notification={selected} />;
}
