"use client";

import { useMemo, type ReactNode } from "react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { panelTurnSteps, runningLabel, type PanelToolPart } from "@hotelclaw/chat-ui/turn";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { AiLoader } from "@/components/ui/ai-loader";
import type { AiFeedbackInput } from "@/lib/ai/feedback";
import { cn } from "@/lib/utils";
import { TurnTrace } from "./agent-turn/turn-trace";
import { Markdown } from "./markdown";
import { ReplyActions } from "./reply-actions";

/**
 * Renderer for the stateless panel bots (task assistant, "Ask the numbers")
 * that stream AI SDK `UIMessage`s through `useChat`. The same shadcn/ui AI
 * Elements composition as `EveConversation` — Message Scroller, Bubble,
 * the shared `TurnTrace` (Reasoning + Tool rows from the message parts),
 * markdown through `Markdown`, and the footer actions — so a panel reads
 * like the assistant, just smaller.
 */
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function partSteps(message: UIMessage, live: boolean) {
  const reasoning: Array<{ text: string; streaming: boolean }> = [];
  const tools: PanelToolPart[] = [];
  for (const part of message.parts) {
    if (part.type === "reasoning") {
      reasoning.push({ text: part.text, streaming: live && part.state === "streaming" });
      continue;
    }
    if (isToolUIPart(part)) {
      const state: PanelToolPart["state"] =
        part.state === "output-available"
          ? "output-available"
          : part.state === "output-error"
            ? "output-error"
            : part.state === "input-streaming"
              ? "input-streaming"
              : "input-available";
      tools.push({
        toolCallId: part.toolCallId,
        toolName: getToolName(part),
        state,
        input: part.input,
        output: part.state === "output-available" ? part.output : undefined,
        errorText: part.state === "output-error" ? part.errorText : undefined,
      });
    }
  }
  return panelTurnSteps(reasoning, tools);
}

export function BotPanelConversation({
  messages,
  status,
  workingLabel = "Thinking…",
  feedback,
  empty,
  className,
  renderAfterAssistant,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  workingLabel?: string;
  feedback?: (Pick<AiFeedbackInput, "propertyId" | "surface"> & { sessionId?: string | null }) | null;
  empty?: ReactNode;
  className?: string;
  /** Extra controls under a finished assistant message (e.g. "Pin this"). */
  renderAfterAssistant?: (message: UIMessage, index: number) => ReactNode;
}) {
  const working = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1];
  const showLoader =
    status === "submitted" ||
    (status === "streaming" &&
      (!last || last.role !== "assistant" || (!messageText(last) && last.parts.length === 0)));

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className={cn("min-h-0", className)}>
        <MessageScrollerViewport>
          <MessageScrollerContent aria-busy={working} className="gap-3 px-3 py-3">
            {messages.length === 0 && !working ? (
              <MessageScrollerItem messageId="empty">{empty ?? null}</MessageScrollerItem>
            ) : null}
            {messages.map((message, index) => {
              const isLast = index === messages.length - 1;
              const live = isLast && working;
              if (message.role === "user") {
                return (
                  <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor>
                    <Message align="end">
                      <MessageContent>
                        <Bubble align="end" variant="muted">
                          <BubbleContent className="text-sm whitespace-pre-wrap">
                            {messageText(message)}
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              }
              return (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <PanelTurn
                    message={message}
                    index={index}
                    live={live}
                    feedback={feedback}
                    renderAfterAssistant={renderAfterAssistant}
                  />
                </MessageScrollerItem>
              );
            })}
            {showLoader ? (
              <MessageScrollerItem messageId="loader">
                <AiLoader label={workingLabel} />
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function PanelTurn({
  message,
  index,
  live,
  feedback,
  renderAfterAssistant,
}: {
  message: UIMessage;
  index: number;
  live: boolean;
  feedback?: (Pick<AiFeedbackInput, "propertyId" | "surface"> & { sessionId?: string | null }) | null;
  renderAfterAssistant?: (message: UIMessage, index: number) => ReactNode;
}) {
  const text = messageText(message);
  const steps = useMemo(() => partSteps(message, live), [message, live]);
  const runningStep = live ? steps.find((s) => s.status === "running") : undefined;
  const activity = runningStep
    ? runningStep.kind === "reasoning"
      ? "Thinking…"
      : `${runningLabel(runningStep.label)}…`
    : text
      ? "Writing…"
      : "Thinking…";
  return (
    <Message>
      <MessageContent className="gap-2">
        {steps.length > 0 || (live && !text) ? (
          <TurnTrace steps={steps} live={live && !text} activity={activity} />
        ) : null}
        {text ? (
          <Markdown isAnimating={live} className="text-sm leading-6">
            {text}
          </Markdown>
        ) : null}
        {text && !live ? (
          <ReplyActions text={text} messageKey={message.id} feedback={feedback} revealOnHover>
            {renderAfterAssistant?.(message, index)}
          </ReplyActions>
        ) : null}
      </MessageContent>
    </Message>
  );
}
