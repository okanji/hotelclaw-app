"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  getNotificationsEnabled,
  setNotificationsEnabled,
} from "@/components/chat/inbox/browser-notifications";

export function NotificationsToggle() {
  const [enabled, setEnabled] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    setEnabled(getNotificationsEnabled());
  }, []);

  function toggle() {
    start(async () => {
      const next = !enabled;
      const ok = await setNotificationsEnabled(next);
      if (next && !ok) {
        toast.error("Browser notifications were denied. Enable in site settings to retry.");
      } else {
        setEnabled(ok);
        toast.success(ok ? "Notifications on" : "Notifications off");
      }
    });
  }

  return (
    <DropdownMenuItem onClick={toggle}>
      {enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      {enabled ? "Disable notifications" : "Enable notifications"}
    </DropdownMenuItem>
  );
}
