"use client";

import { useEffect, useRef } from "react";
import type { Event as StreamEvent } from "stream-chat";
import { useChannelStateContext } from "stream-chat-react";
import { isAppArtifactAttachment } from "@hotelclaw/chat-ui";
import { useArtifactPanel } from "./artifact-panel-context";

/**
 * Auto-opens the split-screen artifact panel when the AI starts writing a
 * record in this channel, so the live edit is visible without anyone having
 * to click "Watch live".
 *
 * Rules that keep it from being obnoxious:
 * - **Live messages only.** Bound to Stream's `message.new` channel event,
 *   which fires only for messages arriving now — opening a channel and
 *   scrolling through old artifact cards must never pop the panel.
 * - **First card of a turn wins.** A turn that writes five documents opens
 *   the panel once, on the first; the rest stay one click away. Keyed on the
 *   `eve_turn` marker the runtime stamps (see `lib/chat/message-grouping.ts`),
 *   falling back to the message id when absent.
 * - **Root conversation only.** Thread replies don't hijack the main panel.
 * - **Wide viewports only.** The panel is a real layout split with a 380px
 *   floor; on a phone it would bury the conversation.
 *
 * Cards only open a panel once they carry a `document_id`, which is why
 * `create_document` reserves the row before writing the body — otherwise a
 * newly created doc has no live room to show until the write has finished.
 */
const MIN_AUTO_OPEN_WIDTH = 768;

export function ArtifactAutoOpen() {
  const { channel } = useChannelStateContext();
  const { open } = useArtifactPanel();
  // Turns already handled. A ref (not state) so it never triggers a render;
  // it resets naturally when the channel remounts.
  const openedTurns = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!channel) return;
    openedTurns.current = new Set();

    const handler = (event: StreamEvent) => {
      // `eve_turn` is a custom field, so the message is read loosely.
      const message = (event as { message?: Record<string, unknown> }).message;
      if (!message || message.parent_id) return;

      const attachments = Array.isArray(message.attachments)
        ? message.attachments
        : [];
      const artifact = attachments.find(isAppArtifactAttachment);
      // Task cards never auto-open: a task insert is instant, so there's no
      // live write to watch — and a turn creating many tasks would otherwise
      // pop the panel on the first of them.
      if (!artifact || artifact.kind === "task") return;
      if (typeof artifact.document_id !== "string") return;

      const turnKey =
        typeof message.eve_turn === "string" && message.eve_turn
          ? message.eve_turn
          : typeof message.id === "string"
            ? message.id
            : null;
      if (!turnKey || openedTurns.current.has(turnKey)) return;
      openedTurns.current.add(turnKey);

      if (window.innerWidth < MIN_AUTO_OPEN_WIDTH) return;

      open({
        kind: artifact.kind === "sheet" ? "sheet" : "document",
        documentId: artifact.document_id,
        title: artifact.title,
      });
    };

    channel.on("message.new", handler);
    return () => {
      channel.off("message.new", handler);
    };
  }, [channel, open]);

  return null;
}
