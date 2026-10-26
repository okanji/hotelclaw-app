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

/**
 * Whether a rendered Form / Questionnaire was already answered. The settled
 * "answers sent" state is client memory, so after a reload a submitted form
 * would come back live (and could be sent twice). A transcript surface that
 * can see the LATER user messages provides this predicate — a form whose
 * submission heading (`formatFormSubmission`) opens a later message is
 * drawn settled. Optional: without it the form is live, as before.
 */
export type ChatUiSubmitted = (title: string | undefined) => boolean;

const ChatUiSubmittedContext = createContext<ChatUiSubmitted | null>(null);

export function ChatUiSubmittedProvider({
  isSubmitted,
  children,
}: {
  isSubmitted: ChatUiSubmitted;
  children: ReactNode;
}) {
  return (
    <ChatUiSubmittedContext.Provider value={isSubmitted}>
      {children}
    </ChatUiSubmittedContext.Provider>
  );
}

export function useChatUiSubmitted(title: string | undefined): boolean {
  const predicate = useContext(ChatUiSubmittedContext);
  return predicate ? predicate(title) : false;
}

/** The heading a submission of this form opens with (see formatFormSubmission). */
export function submissionHeading(title: string | undefined): string {
  return title ? `${title} — answers:` : "Answers:";
}
