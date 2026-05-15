"use client";

import { useEffect } from "react";
import { rememberLastChannel } from "@/lib/chat/last-channel";

/**
 * Records the open channel as this property's "last channel" (localStorage)
 * so the rail can navigate straight back to it. Renders nothing — mounted by
 * the channel route alongside `ChannelView`. Being route-mounted means it
 * covers every way a channel gets opened: sidebar click, command palette,
 * notification, deep link.
 */
export function LastChannelRecorder({
  propertyId,
  channelId,
}: {
  propertyId: string;
  channelId: string;
}) {
  useEffect(() => {
    rememberLastChannel(propertyId, channelId);
  }, [propertyId, channelId]);

  return null;
}
