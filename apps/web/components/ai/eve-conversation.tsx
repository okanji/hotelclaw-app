"use client";

import { useMemo, type ReactNode } from "react";
import {
  runningLabel,
  transcriptTurnSteps,
  type ParkRequest,
  type TurnStep,
} from "@hotelclaw/chat-ui/turn";
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
import { AiUiAttachment } from "@/components/chat/ai-ui-attachment";
import { ChatUiSendProvider } from "@/components/chat/chat-ui-send-context";
import {
  displayUserText,
  renderedSpecs,
  type AssistantItem,
  type ToolCall,
  type TranscriptItem,
} from "@/lib/fleet/transcript";
import { cn } from "@/lib/utils";
import { ParkControls } from "./agent-turn/park-controls";
import { TurnTrace } from "./agent-turn/turn-trace";
import { Markdown } from "./markdown";
import { ReplyActions } from "./reply-actions";
import type { AiFeedbackInput } from "@/lib/ai/feedback";

/**
 * The ONE renderer for an eve session transcript, on shadcn/ui AI Elements.
 *
 * Every human-facing eve surface — the Assistant, an agent chat, a pod-bot
 * test chat, the read-only fleet viewer — hands it the reducer's items
 * (`@hotelclaw/chat-ui/transcript`, shared with mobile) and gets the same
 * reading experience, built the way the "Chat" pattern prescribes: each
 * turn is a Message inside Message Scroller (the person's turn is the
 * scroll anchor, so a new question settles near the top and the reply
 * streams in under it; `autoScroll` follows only while the reader is at
 * the live edge). The person's text is a Bubble; the agent's turn is a
 * Trace of its steps (reasoning, tools, subagents, settled parks — the same
 * `TurnTrace` the channel bot draws), the reply as streamed markdown,
 * inline `render_ui` cards, the controls for an OPEN park (Confirmation /
 * Suggestion), a failure note, and the footer actions (copy, 👍/👎 for the
 * learning loop).
 */
export { displayUserText };

export type EveFeedbackScope = Pick<AiFeedbackInput, "propertyId" | "surface"> & {
  sessionId: string | null;
};

type Respond = (
  requestId: string,
  answer: { optionId?: string; text?: string },
) => void | Promise<void>;

export function EveConversation({
  items,
  busy = false,
  resuming = false,
  workingLabel = "Working on it…",
  scale = "page",
  mono = false,
  showReasoning = true,
  onSend,
  onRespond,
  feedback,
  empty,
  className,
  contentClassName,
}: {
  items: TranscriptItem[];
  busy?: boolean;
  resuming?: boolean;
  workingLabel?: string;
  /** `page` = reading column (assistant); `compact` = side panel / sheet. */
  scale?: "page" | "compact";
  /** Mono tool labels for transparency surfaces (raw names). */
  mono?: boolean;
  showReasoning?: boolean;
  /** Sends a message — used by ai_ui Options chips. Omit for read-only. */
  onSend?: (text: string) => void | Promise<void>;
  /** Answers a parked question / approval. Omit for read-only. */
  onRespond?: Respond;
  /** When set, replies get 👍/👎 actions recorded against this scope. */
  feedback?: EveFeedbackScope | null;
  /** Rendered when there is nothing to show and nothing loading. */
  empty?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const isEmpty = items.length === 0 && !resuming;
  const last = items[items.length - 1];
  // The live turn's trace already says what is happening; the loader only
  // covers the gap before its first event (and a resume).
  const showLoader =
    resuming ||
    (busy &&
      !(
        last &&
        last.kind === "assistant" &&
        (last.text.trim() || last.toolCalls.length > 0 || last.reasoning.length > 0)
      ));

  const body = (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className={cn("min-h-0 flex-1", className)}>
        <MessageScrollerViewport>
          <MessageScrollerContent
            aria-busy={busy}
            className={cn(
              scale === "page" ? "mx-auto w-full max-w-content gap-7 px-6 py-8" : "gap-4 px-4 py-4",
              contentClassName,
            )}
          >
            {isEmpty ? (
              <MessageScrollerItem messageId="empty">{empty ?? null}</MessageScrollerItem>
            ) : (
              <>
                {items.map((item, index) =>
                  item.kind === "user" ? (
                    <MessageScrollerItem key={index} messageId={`turn-${index}`} scrollAnchor>
                      <Message align="end">
                        <MessageContent>
                          <Bubble align="end" variant="muted">
                            <BubbleContent
                              className={cn(
                                "whitespace-pre-wrap",
                                scale === "page" ? "text-base leading-6" : "text-sm",
                              )}
                            >
                              {displayUserText(item.text)}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ) : (
                    <MessageScrollerItem key={index} messageId={`turn-${index}`}>
                      <AssistantTurn
                        item={item}
                        turnIndex={index}
                        scale={scale}
                        mono={mono}
                        showReasoning={showReasoning}
                        onRespond={onRespond}
                        feedback={feedback}
                        // Only the LAST turn can still be live; earlier ones
                        // that never saw a completion event are settled history.
                        live={index === items.length - 1 && (busy || item.streaming)}
                      />
                    </MessageScrollerItem>
                  ),
                )}
                {showLoader ? (
                  <MessageScrollerItem messageId="loader">
                    <AiLoader
                      label={resuming ? "Loading this conversation…" : workingLabel}
                      showElapsed={!resuming}
                    />
                  </MessageScrollerItem>
                ) : null}
              </>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
  // The sender behind ai_ui Options quick-reply chips — tapping one sends the
  // option through the surface's normal send, exactly like typing it.
  return onSend ? <ChatUiSendProvider send={onSend}>{body}</ChatUiSendProvider> : body;
}

function AssistantTurn({
  item,
  turnIndex,
  scale,
  mono,
  showReasoning,
  onRespond,
  feedback,
  live,
}: {
  item: AssistantItem;
  turnIndex: number;
  scale: "page" | "compact";
  mono: boolean;
  showReasoning: boolean;
  onRespond?: Respond;
  feedback?: EveFeedbackScope | null;
  live: boolean;
}) {
  const steps = useMemo(() => {
    let rows: TurnStep[] = transcriptTurnSteps(item, { running: live });
    if (!showReasoning) rows = rows.filter((s) => s.kind !== "reasoning");
    // Transparency surfaces show the raw tool name as the row label; the
    // payload is in the disclosure either way.
    if (mono) rows = rows.map((s) => (s.toolName ? { ...s, label: s.toolName } : s));
    return rows;
  }, [item, live, showReasoning, mono]);
  const runningStep = live ? steps.find((s) => s.status === "running") : undefined;
  const activity = runningStep
    ? runningStep.kind === "reasoning"
      ? "Thinking…"
      : `${runningLabel(runningStep.label)}…`
    : item.text.trim()
      ? "Writing…"
      : "Working on it…";
  const openRequests: ParkRequest[] = item.requests.filter((r) => !r.outcome);
  const hasBody = Boolean(item.text.trim());

  return (
    <Message>
      <MessageContent className="gap-3">
        {steps.length > 0 || live ? (
          <TurnTrace
            steps={steps}
            live={live && !hasBody}
            activity={activity}
            className={cn(mono && "[&_[data-slot=trace-title]]:font-mono [&_[data-slot=trace-title]]:text-xs")}
          />
        ) : null}
        {hasBody ? (
          <Markdown
            isAnimating={live && item.streaming}
            className={cn(
              scale === "page"
                ? "text-base leading-7 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base"
                : "text-sm leading-6",
            )}
          >
            {item.text}
          </Markdown>
        ) : null}
        <RenderedViews calls={item.toolCalls} />
        {openRequests.length > 0 ? (
          <ParkControls
            requests={openRequests}
            onChoose={
              onRespond ? (request, option) => onRespond(request.requestId, { optionId: option.id }) : null
            }
            onAnswer={
              onRespond ? (request, text) => onRespond(request.requestId, { text }) : null
            }
          />
        ) : null}
        {item.failure ? (
          <p className="rounded-md bg-pill-danger px-3 py-2 text-sm text-pill-danger-ink">
            {item.failure.message || "That turn failed."}{" "}
            <span className="font-mono text-xs opacity-70">{item.failure.code}</span>
          </p>
        ) : null}
        {hasBody && !live ? (
          <ReplyActions
            text={item.text}
            messageKey={`turn-${turnIndex}`}
            feedback={feedback}
            revealOnHover
          />
        ) : null}
      </MessageContent>
    </Message>
  );
}

/**
 * Inline rich UI. The eve `render_ui` tool validates the spec and returns it
 * in the tool RESULT as `ai_ui_spec`; the transcript renders it with the same
 * catalog component the channel uses, so a table looks identical wherever
 * the assistant draws it.
 */
function RenderedViews({ calls }: { calls: ToolCall[] }) {
  const specs = useMemo(() => renderedSpecs(calls), [calls]);
  if (specs.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-3">
      {specs.map((entry) => (
        <AiUiAttachment
          key={entry.callId}
          attachment={{ type: "ai_ui", spec: entry.spec } as never}
        />
      ))}
    </div>
  );
}
