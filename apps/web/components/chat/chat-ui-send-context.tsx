"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * How an `ai_ui` Options chip sends its reply. The catalog's Options
 * component is surface-agnostic — a Stream channel and an assistant pane
 * deliver messages completely differently, so each surface provides its
 * own sender:
 *
 * - Stream chat: `SlackAttachment` wraps AiUiAttachments with a sender
 *   that calls `channel.sendMessage` (threading into the bot message's
 *   thread when it has one).
 * - Assistant: the transcript wraps itself with the pane's `send`.
 *
 * Optional on purpose: with no provider the chips render as a plain
 * non-interactive list, so an old message or an unwired surface degrades
 * gracefully instead of crashing or half-working.
 */
export type ChatUiSend = (text: string) => void | Promise<void>;

const ChatUiSendContext = createContext<ChatUiSend | null>(null);

export function ChatUiSendProvider({
  send,
  children,
}: {
  send: ChatUiSend;
  children: ReactNode;
}) {
  return (
    <ChatUiSendContext.Provider value={send}>
      {children}
    </ChatUiSendContext.Provider>
  );
}

export function useOptionalChatUiSend(): ChatUiSend | null {
  return useContext(ChatUiSendContext);
}
