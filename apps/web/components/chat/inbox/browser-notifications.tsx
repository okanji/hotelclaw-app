"use client";

import { useEffect } from "react";
import { useChatContext } from "stream-chat-react";

const STORAGE_KEY = "hotelclaw:browser-notifications";

/**
 * Fires native browser notifications when the user receives a message in a
 * channel they're not actively viewing AND the document is hidden / unfocused.
 *
 * Opt-in via `localStorage` flag (set by the toggle in the user dropdown).
 * Permission is requested lazily on first event after opt-in.
 */
export function BrowserNotifications() {
  const { client, channel: activeChannel } = useChatContext();

  useEffect(() => {
    if (!client) return;
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") return;

    const sub = client.on("notification.message_new", (event) => {
      try {
        if (window.localStorage.getItem(STORAGE_KEY) !== "on") return;
        if (Notification.permission !== "granted") return;
        if (document.visibilityState === "visible" && document.hasFocus()) return;
        // Don't notify for the channel the user is sitting in (visible+focused).
        if (event.channel_id && activeChannel?.id === event.channel_id) return;

        const senderName =
          event.user?.name ?? event.user?.id ?? "New message";
        const channelName =
          (event.channel as { name?: string } | undefined)?.name ??
          event.channel_id ??
          "channel";
        const text = event.message?.text ?? "(attachment)";

        const n = new Notification(`${senderName} in #${channelName}`, {
          body: text,
          tag: event.channel_id, // collapse repeated notifs per channel
          icon: "/favicon.ico",
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // ignore — browser notifications shouldn't crash the app
      }
    });
    return () => sub.unsubscribe();
  }, [client, activeChannel]);

  return null;
}

/**
 * Helpers used by the dropdown toggle.
 */
export function getNotificationsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "on";
}

export async function setNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!enabled) {
    window.localStorage.removeItem(STORAGE_KEY);
    return false;
  }
  if (typeof Notification === "undefined") return false;
  let perm = Notification.permission;
  if (perm === "default") {
    perm = await Notification.requestPermission();
  }
  if (perm !== "granted") return false;
  window.localStorage.setItem(STORAGE_KEY, "on");
  return true;
}
