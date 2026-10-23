"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AiLoader } from "@/components/ui/ai-loader";
import { ToolTrace } from "@/components/ai/tool-trace";
import { AiUiAttachment } from "@/components/chat/ai-ui-attachment";
import { ChatUiSendProvider } from "@/components/chat/chat-ui-send-context";
import { SILENT_TOOLS, toolLabel } from "@/lib/assistant/tool-labels";
import {
  displayUserText,
  renderedSpecs,
  type AssistantItem,
  type InputRequest,
  type ToolCall,
  type TranscriptItem,
} from "@/lib/fleet/transcript";
import { cn } from "@/lib/utils";
import { recordAiFeedback, type AiFeedbackInput } from "./feedback-actions";

/**
 * The ONE renderer for an eve session transcript, built on AI Elements.
 *
 * Every human-facing eve surface — the Assistant, an agent chat, a pod-bot
 * test chat, the read-only fleet viewer — hands it the reducer's items
 * (`@hotelclaw/chat-ui/transcript`, shared with mobile) and gets the same
 * reading experience: streaming markdown (Streamdown: code, math, mermaid,
 * incomplete-markdown repair while tokens arrive), a collapsible reasoning
 * trace, grouped tool activity, inline render_ui cards, subagent tasks, and
 * the two kinds of park an eve turn can hold on — a question (options as
 * suggestion chips, free text when allowed) and a tool approval (approve /
 * cancel card). It also carries the learning loop's thumbs: 👍/👎 + a note
 * on any reply, recorded through `recordAiFeedback` and distilled into
 * memory nightly.
 */
export { displayUserText };

export type EveFeedbackScope = Pick<AiFeedbackInput, "propertyId" | "surface"> & {
  sessionId: string | null;
};

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
  onRespond?: (
    requestId: string,
    answer: { optionId?: string; text?: string },
  ) => void | Promise<void>;
  /** When set, replies get 👍/👎 actions recorded against this scope. */
  feedback?: EveFeedbackScope | null;
  /** Rendered when there is nothing to show and nothing loading. */
  empty?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const isEmpty = items.length === 0 && !resuming;
  const body = (
    <Conversation className={cn("min-h-0 flex-1", className)}>
      <ConversationContent
        className={cn(
          scale === "page" ? "mx-auto w-full max-w-content gap-7 px-6 py-8" : "gap-4 px-4 py-4",
          contentClassName,
        )}
      >
        {isEmpty ? (
          empty ?? null
        ) : (
          <>
            {items.map((item, index) =>
              item.kind === "user" ? (
                <Message from="user" key={index}>
                  <MessageContent
                    className={cn(
                      "whitespace-pre-wrap",
                      scale === "page" ? "text-base leading-6" : "text-sm",
                    )}
                  >
                    {displayUserText(item.text)}
                  </MessageContent>
                </Message>
              ) : (
                <AssistantTurn
                  key={index}
                  item={item}
                  turnIndex={index}
                  scale={scale}
                  mono={mono}
                  showReasoning={showReasoning}
                  onRespond={onRespond}
                  feedback={feedback}
                  // Only the LAST turn can still be live; earlier ones that
                  // never saw a completion event are settled history.
                  live={index === items.length - 1 && (busy || item.streaming)}
                />
              ),
            )}
            {busy || resuming ? (
              <AiLoader
                label={resuming ? "Loading this conversation…" : workingLabel}
                showElapsed={!resuming}
              />
            ) : null}
          </>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
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
  onRespond?: (
    requestId: string,
    answer: { optionId?: string; text?: string },
  ) => void | Promise<void>;
  feedback?: EveFeedbackScope | null;
  live: boolean;
}) {
  const shownCalls = item.toolCalls.filter((call) => !SILENT_TOOLS.has(call.toolName));
  const reasoning = item.reasoning.filter((r) => r.trim()).join("\n\n");
  const hasBody = Boolean(item.text.trim());
  return (
    <Message from="assistant" className="max-w-full gap-3">
      {showReasoning && reasoning ? (
        <Reasoning isStreaming={live && !hasBody} defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoning}</ReasoningContent>
        </Reasoning>
      ) : null}
      {shownCalls.length > 0 ? (
        <ToolTrace
          calls={shownCalls}
          mono={mono}
          labelFor={(call) => (mono ? call.toolName : toolLabel(call.toolName))}
        />
      ) : null}
      {item.tasks.length > 0 ? <TaskRuns tasks={item.tasks} /> : null}
      <RenderedViews calls={item.toolCalls} />
      {hasBody ? (
        <MessageContent className="w-full max-w-full">
          <MessageResponse
            isAnimating={live && item.streaming}
            className={cn(
              scale === "page"
                ? "text-base leading-7 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base"
                : "text-sm leading-6",
            )}
          >
            {item.text}
          </MessageResponse>
        </MessageContent>
      ) : null}
      {item.requests.map((request) => (
        <InputRequestCard
          key={request.requestId}
          request={request}
          onRespond={onRespond}
          disabled={!onRespond}
        />
      ))}
      {item.failure ? (
        <p className="rounded-md bg-pill-danger px-3 py-2 text-sm text-pill-danger-ink">
          {item.failure.message || "That turn failed."}{" "}
          <span className="font-mono text-xs opacity-70">{item.failure.code}</span>
        </p>
      ) : null}
      {hasBody && !live ? (
        <ReplyActions text={item.text} messageKey={`turn-${turnIndex}`} feedback={feedback} />
      ) : null}
    </Message>
  );
}

/** Copy + thumbs. A 👎 opens a one-line note; the note is what the memory
 * distiller turns into a durable preference, so it is worth asking for. */
function ReplyActions({
  text,
  messageKey,
  feedback,
}: {
  text: string;
  messageKey: string;
  feedback?: EveFeedbackScope | null;
}) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const rate = async (value: 1 | -1, withNote?: string) => {
    if (!feedback) return;
    setRating(value);
    if (value === -1 && withNote === undefined) setNoteOpen(true);
    const result = await recordAiFeedback({
      propertyId: feedback.propertyId,
      surface: feedback.surface,
      sessionId: feedback.sessionId,
      messageKey,
      rating: value,
      note: withNote,
      excerpt: text.slice(0, 600),
    });
    if ("error" in result) toast.error(result.error);
    else if (withNote !== undefined) {
      setNoteOpen(false);
      toast.success("Thanks — I'll remember that.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <MessageActions className="-ml-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 data-[rated=true]:opacity-100" data-rated={rating !== null}>
        <MessageAction tooltip={copied ? "Copied" : "Copy"} onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </MessageAction>
        {feedback ? (
          <>
            <MessageAction
              tooltip="Good answer"
              onClick={() => rate(1)}
              className={cn(rating === 1 && "text-pill-success-ink")}
            >
              <ThumbsUp className="size-3.5" />
            </MessageAction>
            <MessageAction
              tooltip="Needs work"
              onClick={() => rate(-1)}
              className={cn(rating === -1 && "text-pill-danger-ink")}
            >
              <ThumbsDown className="size-3.5" />
            </MessageAction>
          </>
        ) : null}
      </MessageActions>
      {noteOpen ? (
        <form
          className="flex max-w-md items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void rate(-1, note.trim());
          }}
        >
          <Textarea
            autoFocus
            rows={1}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should it have done? (saved as a preference)"
            className="min-h-9 flex-1 resize-none text-sm"
          />
          <Button type="submit" size="sm" disabled={!note.trim()}>
            Save
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => setNoteOpen(false)}
          >
            <X className="size-3.5" />
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Subagent / background task runs (eve `task.started` / `task.settled`). */
function TaskRuns({ tasks }: { tasks: AssistantItem["tasks"] }) {
  return (
    <div className="flex flex-col gap-1">
      {tasks.map((task) => (
        <Task key={task.taskId} defaultOpen={false}>
          <TaskTrigger
            title={`${task.kind === "agent" ? "Subagent" : "Task"}: ${task.name} · ${
              task.status === "working" ? "running" : task.status
            }`}
          />
          <TaskContent>
            {task.error ? (
              <TaskItem className="text-pill-danger-ink">{task.error}</TaskItem>
            ) : null}
            {task.output !== undefined ? (
              <TaskItem>
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-5 whitespace-pre-wrap">
                  {typeof task.output === "string"
                    ? task.output
                    : JSON.stringify(task.output, null, 2)}
                </pre>
              </TaskItem>
            ) : null}
          </TaskContent>
        </Task>
      ))}
    </div>
  );
}

/**
 * A parked request. Questions render their options as suggestion chips (plus
 * free text when the tool allowed it); approvals render the gated action with
 * Approve / Cancel. Answered requests settle into one quiet line so the
 * transcript still shows what was asked and what was chosen.
 */
function InputRequestCard({
  request,
  onRespond,
  disabled,
}: {
  request: InputRequest;
  onRespond?: (
    requestId: string,
    answer: { optionId?: string; text?: string },
  ) => void | Promise<void>;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const isApproval = request.kind === "tool-approval";
  const title = isApproval
    ? `Approve: ${request.action ? toolLabel(request.action.toolName) : "this action"}`
    : request.prompt || "The assistant has a question";

  if (request.outcome) {
    const chosen =
      request.options.find((o) => o.id === request.answer)?.label ?? request.answer;
    return (
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span>
        {" — "}
        {request.outcome === "cancelled" || request.outcome === "expired"
          ? request.outcome
          : chosen
            ? `you chose "${chosen}"`
            : "answered"}
      </p>
    );
  }

  const options =
    request.options.length > 0
      ? request.options
      : isApproval
        ? [
            { id: "approve", label: "Approve", description: null },
            { id: "cancel", label: "Cancel", description: null },
          ]
        : [];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-card border p-4",
        isApproval ? "border-warning/40 bg-pill-warning" : "border-border bg-card",
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        {isApproval && request.prompt ? (
          <p className="text-sm text-muted-foreground">{request.prompt}</p>
        ) : null}
        {isApproval && request.action?.input ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Details</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono leading-5 whitespace-pre-wrap">
              {JSON.stringify(request.action.input, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
      {isApproval ? (
        <div className="flex gap-2">
          {options.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={/approve|yes|allow/i.test(option.id) ? "default" : "outline"}
              disabled={disabled}
              onClick={() => onRespond?.(request.requestId, { optionId: option.id })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : (
        <>
          {options.length > 0 ? (
            <Suggestions className="w-full">
              {options.map((option) => (
                <Suggestion
                  key={option.id}
                  suggestion={option.id}
                  disabled={disabled}
                  title={option.description ?? undefined}
                  onClick={(id) => onRespond?.(request.requestId, { optionId: id })}
                >
                  {option.label}
                </Suggestion>
              ))}
            </Suggestions>
          ) : null}
          {request.allowFreeform || options.length === 0 ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                void onRespond?.(request.requestId, { text: text.trim() });
                setText("");
              }}
            >
              <Textarea
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type an answer…"
                disabled={disabled}
                className="min-h-9 flex-1 resize-none text-sm"
              />
              <Button type="submit" size="sm" disabled={disabled || !text.trim()}>
                Answer
              </Button>
            </form>
          ) : null}
        </>
      )}
    </div>
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
