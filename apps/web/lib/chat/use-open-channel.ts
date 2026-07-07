"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { channelHref } from "./channel-href";

/**
 * Pathnames that mount the persistent chat surface (`<ChatSurface>`). Inside
 * them, switching channels is a client-side `pushState`; arriving from another
 * section is a real navigation.
 */
const IN_CHAT_SURFACE = /^\/p\/[^/]+\/(?:chat|dms)(?:\/|$)/;

/**
 * Opens a chat channel or DM.
 *
 * When the user is already inside the chat surface, this is a pure
 * `window.history.pushState` — no Next route navigation, no RSC round-trip, no
 * `loading.tsx` skeleton. The persistent `<ChatSurface>` re-renders off the new
 * URL and the already-watched channel paints instantly. Called from another
 * section, it's a normal `router.push` that enters the chat surface.
 *
 * Single chokepoint for channel navigation — mirrors `channelHref`.
 */
export function useOpenChannel(propertyId: string) {
  const router = useRouter();
  return useCallback(
    (
      channelType: string | undefined,
      channelId: string,
      opts?: { messageId?: string },
    ) => {
      const href = channelHref(propertyId, channelType, channelId, opts);
      if (IN_CHAT_SURFACE.test(window.location.pathname)) {
        window.history.pushState(null, "", href);
        // `usePathname` only updates on real navigations — tell the surface to
        // re-derive off the new URL so the channel switch paints instantly.
        window.dispatchEvent(new Event("hotelclaw:pathname"));
      } else {
        router.push(href);
      }
    },
    [propertyId, router],
  );
}
