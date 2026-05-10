"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { NotificationRow } from "@/lib/notifications/types";
import { NotificationItem } from "./notification-item";

type Props = {
  userId: string;
  propertyId: string;
};

/**
 * Sidebar bell entry + popover feed. Subscribes to Supabase Realtime for
 * the current user's notifications table, so new notifications fade in
 * without a refresh.
 */
export function NotificationsBell({ userId, propertyId }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery<NotificationRow[]>({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const r = await fetch("/api/me/notifications?limit=30", {
        cache: "no-store",
      });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 10_000,
  });

  // Realtime subscription — Supabase pushes INSERT/UPDATE events on the
  // notifications table filtered to this user.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Refetch on any change — easier than reconciling diffs manually.
          qc.invalidateQueries({ queryKey: ["notifications", userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const unseenCount = useMemo(
    () => notifications.filter((n) => !n.seen_at).length,
    [notifications],
  );

  async function markAllRead() {
    const unseen = notifications.filter((n) => !n.seen_at);
    if (unseen.length === 0) return;
    // Optimistic.
    qc.setQueryData<NotificationRow[]>(["notifications", userId], (prev) =>
      (prev ?? []).map((n) =>
        n.seen_at ? n : { ...n, seen_at: new Date().toISOString() },
      ),
    );
    const r = await fetch("/api/me/notifications/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    if (!r.ok) {
      toast.error("Failed to mark as read");
      qc.invalidateQueries({ queryKey: ["notifications", userId] });
    }
  }

  async function markRead(id: string) {
    qc.setQueryData<NotificationRow[]>(["notifications", userId], (prev) =>
      (prev ?? []).map((n) =>
        n.id === id ? { ...n, seen_at: new Date().toISOString() } : n,
      ),
    );
    await fetch("/api/me/notifications/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => {});
  }

  function handleSelect(n: NotificationRow, href: string | null) {
    setOpen(false);
    void markRead(n.id);
    if (href) router.push(href);
  }

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<SidebarMenuButton tooltip="Notifications" />}
        >
          <Bell />
          <span>Notifications</span>
          {unseenCount > 0 ? (
            <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
              {unseenCount > 99 ? "99+" : unseenCount}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-[380px] p-0"
        >
          <header className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            {unseenCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={markAllRead}
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </Button>
            ) : null}
          </header>
          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
                <Bell className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">You're all caught up</p>
                <p className="text-xs text-muted-foreground">
                  Mentions, task assignments, and invites will show up here.
                </p>
              </div>
            ) : (
              <ul role="list" className="divide-y">
                {notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    propertyId={propertyId}
                    onSelect={(href) => handleSelect(n, href)}
                  />
                ))}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
