import React, { createContext, useContext, type ReactNode } from "react";

/**
 * How a rendered `ai_ui` element (Options chip, Form, Questionnaire) sends
 * its reply — the phone twin of web's `chat-ui-send-context.tsx`. A Stream
 * channel and the Assistant deliver messages completely differently, so a
 * surface that is NOT a channel (the Assistant transcript) wraps the
 * attachment in this provider; inside a channel the renderers fall back
 * to `channel.sendMessage` from Stream's own context.
 */
export type ChatUiSend = (text: string) => void | Promise<void>;

const ChatUiSendContext = createContext<ChatUiSend | null>(null);

export function ChatUiSendProvider({ send, children }: { send: ChatUiSend; children: ReactNode }) {
  return <ChatUiSendContext.Provider value={send}>{children}</ChatUiSendContext.Provider>;
}

export function useOptionalChatUiSend(): ChatUiSend | null {
  return useContext(ChatUiSendContext);
}

/**
 * Whether a rendered Form / Questionnaire was already answered (the settled
 * state is client memory, so after a reload a submitted form would come back
 * live). The Assistant transcript provides it from the LATER user messages.
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
  return <ChatUiSubmittedContext.Provider value={isSubmitted}>{children}</ChatUiSubmittedContext.Provider>;
}

export function useChatUiSubmitted(title: string | undefined): boolean {
  const predicate = useContext(ChatUiSubmittedContext);
  return predicate ? predicate(title) : false;
}

/** The heading a submission of this form opens with (see formatFormSubmission). */
export function submissionHeading(title: string | undefined): string {
  return title ? `${title} — answers:` : "Answers:";
}
