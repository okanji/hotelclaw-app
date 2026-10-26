"use client";

import { useCallback } from "react";
import { useChannelStateContext, useMessageContext } from "stream-chat-react";

/**
 * How a tap on a bot's quick-reply chip / Approve button becomes a message.
 *
 * The reply travels as the person's OWN channel message, so it goes through
 * the normal message.new → classifier → eve pipeline and everyone in the
 * channel sees who answered — the "continues a conversation with the bot"
 * rule answers it without a fresh @-mention, and the web glue addresses it
 * to the parked request by label / id / index (buildInputResponses).
 *
 * - `send`: posts beside the bot message (into its thread when it has one).
 * - `sendSelfThread`: posts INTO the bot message's own thread. Background-job
 *   parks need this — the question message id is the only route back to the
 *   job's session (0098); a top-level reply would leave the job waiting.
 */
export function useQuickReplySender(scope = "QuickReply") {
  const { channel } = useChannelStateContext(scope);
  const { message } = useMessageContext(scope);
  const parentId = message?.parent_id;
  const messageId = message?.id;

  const send = useCallback(
    async (text: string) => {
      await channel.sendMessage({
        text,
        ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
      });
    },
    [channel, parentId],
  );

  const sendSelfThread = useCallback(
    async (text: string) => {
      await channel.sendMessage({
        text,
        ...(messageId ? { parent_id: messageId, show_in_channel: false } : {}),
      });
    },
    [channel, messageId],
  );

  return { send, sendSelfThread, channelId: channel.id ?? null };
}
