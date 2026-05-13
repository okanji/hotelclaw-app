"use client";

import { renderText as defaultRenderText } from "stream-chat-react";
import type { UserResponse } from "stream-chat";

/**
 * Slack-style broadcast mentions: `@channel`, `@here`, `@everyone`.
 *
 * Stream's default `renderText` produces a mention pill (`<mention>` →
 * `.str-chat__message-mention[data-user-id="X"]`) by matching `@token` text
 * in the message body against entries in `mentionedUsers`. Real users are
 * already in that list (set by the composer). Broadcasts are not — and we
 * don't store them in `message.mentioned_users` because Stream's backend
 * would try to validate them as real Stream user IDs.
 *
 * Instead we inject synthetic `{ id, name }` entries here, at render time
 * only, when the text actually contains the broadcast token. Stream's parser
 * then produces a normal mention pill whose `data-user-id="channel"`
 * matches the broadcast styling already declared in
 * `app/stream-chat-overrides.css`.
 */
const BROADCAST_TOKENS = ["channel", "here", "everyone"] as const;

export const slackRenderText: typeof defaultRenderText = (
  text,
  mentionedUsers,
  options,
) => {
  if (!text) return defaultRenderText(text, mentionedUsers, options);

  let augmented: UserResponse[] | undefined = mentionedUsers;
  for (const token of BROADCAST_TOKENS) {
    if (!new RegExp(`@${token}\\b`).test(text)) continue;
    if (augmented?.some((u) => u.id === token)) continue;
    augmented = [
      ...(augmented ?? []),
      { id: token, name: token } as UserResponse,
    ];
  }

  return defaultRenderText(text, augmented, options);
};
