"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/components/shell/use-notifications";
import { notificationView } from "@/components/shell/notification-item";
import type { NotificationRow } from "@/lib/notifications/types";
import {
  DividerList,
  relativeShort,
  WidgetEmpty,
} from "../editorial-section";

const LIMIT = 6;

/** The current user's recent activity — task assignments, @-mentions, invites,
 *  meeting recaps, workflow alerts — in the editorial dashboard language.
 *  Reuses the shared `notificationView` mapper so the wording matches the
 *  Activity page; clicking a row marks it read and opens the target. */
export function ActivityWidget({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { notifications } = useNotifications(userId);
  const recent = useMemo(() => notifications.slice(0, LIMIT), [notifications]);

  function handleSelect(n: NotificationRow, href: string | null) {
    if (!n.seen_at) {
      const now = new Date().toISOString();
      qc.setQueryData<NotificationRow[]>(["notifications", userId], (prev) =>
        (prev ?? []).map((x) =>
          x.id === n.id ? { ...x, seen_at: now } : x,
        ),
      );
      void fetch("/api/me/notifications/mark-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [n.id] }),
      }).catch(() => {});
    }
    router.push(href ?? `/p/${propertyId}/activity?n=${n.id}`);
  }

  if (recent.length === 0)
    return <WidgetEmpty>You&apos;re all caught up — no recent activity.</WidgetEmpty>;

  return (
    <DividerList>
      {recent.map((n) => {
        const v = notificationView(n, propertyId);
        const unseen = !n.seen_at;
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => handleSelect(n, v.href)}
              className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <span
                className={cn(
                  "mt-0.5 flex shrink-0 items-center",
                  unseen ? "text-foreground" : "text-faint-foreground",
                )}
                aria-hidden="true"
              >
                {v.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-snug text-foreground">
                  {v.lead}
                </p>
                {v.sub ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {v.sub}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                {unseen ? (
                  <span
                    className="size-1.5 rounded-full bg-foreground"
                    aria-label="Unread"
                  />
                ) : null}
                <span className="text-xs text-faint-foreground tabular-nums">
                  {relativeShort(n.created_at)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </DividerList>
  );
}
