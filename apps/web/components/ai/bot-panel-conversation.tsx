"use client";

import { useState } from "react";
import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
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
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { AiLoader } from "@/components/ui/ai-loader";
import { toolLabel } from "@/lib/assistant/tool-labels";
import { cn } from "@/lib/utils";
import { recordAiFeedback, type AiFeedbackInput } from "./feedback-actions";

/**
 * Renderer for the stateless panel bots (task assistant, "Ask the numbers")
 * that stream AI SDK `UIMessage`s through `useChat`. Same AI Elements
 * vocabulary as `EveConversation` — Message / MessageResponse (Streamdown),
 * Reasoning, Tool with live state badges — so a panel reads like the
 * assistant, just smaller. Carries the same 👍/👎 learning-loop actions.
 */
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
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
  empty?: React.ReactNode;
  className?: string;
  /** Extra controls under a finished assistant message (e.g. "Pin this"). */
  renderAfterAssistant?: (message: UIMessage, index: number) => React.ReactNode;
}) {
  const working = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1];
  const showLoader =
    status === "submitted" ||
    (status === "streaming" && (!last || last.role !== "assistant" || !messageText(last)));

  return (
    <Conversation className={cn("min-h-0", className)}>
      <ConversationContent className="gap-3 px-3 py-3">
        {messages.length === 0 && !working ? (empty ?? null) : null}
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          const live = isLast && working;
          if (message.role === "user") {
            return (
              <Message from="user" key={message.id}>
                <MessageContent className="text-sm whitespace-pre-wrap">
                  {messageText(message)}
                </MessageContent>
              </Message>
            );
          }
          const text = messageText(message);
          return (
            <Message from="assistant" key={message.id} className="max-w-full gap-2">
              {message.parts.map((part, partIndex) => {
                if (part.type === "reasoning") {
                  return part.text.trim() ? (
                    <Reasoning
                      key={`${message.id}-r-${partIndex}`}
                      isStreaming={live && part.state === "streaming"}
                      defaultOpen={false}
                    >
                      <ReasoningTrigger />
                      <ReasoningContent>{part.text}</ReasoningContent>
                    </Reasoning>
                  ) : null;
                }
                if (isToolUIPart(part)) {
                  const name = getToolName(part);
                  return (
                    <Tool key={part.toolCallId} defaultOpen={false}>
                      {part.type === "dynamic-tool" ? (
                        <ToolHeader
                          type="dynamic-tool"
                          toolName={name}
                          state={part.state}
                          title={toolLabel(name)}
                        />
                      ) : (
                        <ToolHeader type={part.type} state={part.state} title={toolLabel(name)} />
                      )}
                      <ToolContent>
                        {part.input !== undefined ? <ToolInput input={part.input} /> : null}
                        {part.state === "output-available" || part.state === "output-error" ? (
                          <ToolOutput
                            output={part.state === "output-available" ? part.output : undefined}
                            errorText={part.state === "output-error" ? part.errorText : undefined}
                          />
                        ) : null}
                      </ToolContent>
                    </Tool>
                  );
                }
                return null;
              })}
              {text ? (
                <MessageContent className="w-full max-w-full">
                  <MessageResponse isAnimating={live} className="text-sm leading-6">
                    {text}
                  </MessageResponse>
                </MessageContent>
              ) : null}
              {text && !live ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ReplyActions
                    text={text}
                    messageKey={message.id}
                    feedback={feedback}
                  />
                  {renderAfterAssistant?.(message, index)}
                </div>
              ) : null}
            </Message>
          );
        })}
        {showLoader ? <AiLoader label={workingLabel} /> : null}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function ReplyActions({
  text,
  messageKey,
  feedback,
}: {
  text: string;
  messageKey: string;
  feedback?: (Pick<AiFeedbackInput, "propertyId" | "surface"> & { sessionId?: string | null }) | null;
}) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  const rate = async (value: 1 | -1) => {
    if (!feedback) return;
    setRating(value);
    const result = await recordAiFeedback({
      propertyId: feedback.propertyId,
      surface: feedback.surface,
      sessionId: feedback.sessionId ?? null,
      messageKey,
      rating: value,
      excerpt: text.slice(0, 600),
    });
    if ("error" in result) toast.error(result.error);
  };

  return (
    <MessageActions className="-ml-1.5">
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
  );
}
