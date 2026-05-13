"use client";

import { useEffect, useRef } from "react";
import { useChannelActionContext, useChannelStateContext } from "stream-chat-react";

/**
 * When mounted inside <Channel> with a `messageId`, fetches a window of
 * messages around that id and scrolls it into view. Stream's MessageList
 * auto-applies `str-chat__message--highlighted` for ~1s to flash the row.
 * We track the last id we acted on so toggling between hits inside the same
 * channel triggers another jump.
 */
export function MessageJumper({ messageId }: { messageId: string | null }) {
  const { jumpToMessage } = useChannelActionContext("MessageJumper");
  const { channel } = useChannelStateContext();
  const lastJumpRef = useRef<string | null>(null);

  useEffect(() => {
    if (!messageId) return;
    const key = `${channel.cid}:${messageId}`;
    if (lastJumpRef.current === key) return;
    lastJumpRef.current = key;
    jumpToMessage(messageId).catch((e) => {
      console.error("jumpToMessage failed", e);
    });
  }, [messageId, channel, jumpToMessage]);

  return null;
}
