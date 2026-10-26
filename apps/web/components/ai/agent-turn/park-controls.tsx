"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  GaugeIcon,
  OctagonXIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  isAffirmativeOption,
  parkInputLines,
  parkOptions,
  parkOutcome,
  parkTitle,
  settledParkLabel,
  type ParkOption,
  type ParkRequest,
} from "@hotelclaw/chat-ui/turn";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { cn } from "@/lib/utils";

/**
 * The controls for a turn parked on human input — eve's `ask_question`
 * (kind "question"), a gated tool (kind "tool-approval") or its session
 * budget prompt (kind "session-limit"). One component for every surface:
 * the channel bot answers through the person's own channel message, the
 * Assistant / Agents / fleet surfaces through `inputResponses` — the
 * caller decides what a tap does via `onChoose` / `onAnswer`.
 *
 * Two shadcn/ui AI Elements patterns:
 *  - Confirmation — an approval "is a question for the person, not a step
 *    the agent took, so it sits outside Trace as an Item" with Deny /
 *    Approve buttons; once answered it becomes a line.
 *  - Suggestion — a question's options are a row of outline Buttons; "the
 *    label is the message, send it as is".
 */

export type ParkChoose = (request: ParkRequest, option: ParkOption) => Promise<void> | void;
export type ParkAnswer = (request: ParkRequest, text: string) => Promise<void> | void;

function optionVariant(style: string | null | undefined, fallback: "outline" | "default") {
  if (style === "danger") return "destructive" as const;
  if (style === "primary") return "default" as const;
  return fallback;
}

/** A settled park reads as one Trace line. */
export function SettledPark({ request }: { request: ParkRequest }) {
  const outcome = parkOutcome(request);
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          {outcome === "denied" ? (
            <OctagonXIcon />
          ) : outcome === "withdrawn" ? (
            <CircleHelpIcon />
          ) : (
            <CircleCheckIcon />
          )}
        </TraceIcon>
        <TraceTitle>{settledParkLabel(request)}</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

function RequestControl({
  request,
  onChoose,
  onAnswer,
  disabled,
}: {
  request: ParkRequest;
  onChoose: ParkChoose | null;
  onAnswer: ParkAnswer | null;
  disabled: boolean;
}) {
  const [sentId, setSentId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const busy = disabled || sending || !onChoose;

  const choose = async (option: ParkOption) => {
    if (!onChoose || busy) return;
    setSending(true);
    try {
      await onChoose(request, option);
      setSentId(option.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send that reply");
    } finally {
      setSending(false);
    }
  };

  const answer = async () => {
    const value = text.trim();
    if (!onAnswer || !value || busy) return;
    setSending(true);
    try {
      await onAnswer(request, value);
      setSentId("__text");
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send that reply");
    } finally {
      setSending(false);
    }
  };

  if (request.outcome) return <SettledPark request={request} />;

  if (request.kind === "tool-approval" || request.kind === "session-limit") {
    const isLimit = request.kind === "session-limit";
    const lines = parkInputLines(request.action?.input);
    const options = parkOptions(request);
    return (
      <Item variant="outline" size="sm" className="max-w-xl">
        <ItemMedia variant="icon">{isLimit ? <GaugeIcon /> : <ShieldCheckIcon />}</ItemMedia>
        <ItemContent>
          <ItemTitle>{parkTitle(request)}</ItemTitle>
          {isLimit && request.prompt ? <ItemDescription>{request.prompt}</ItemDescription> : null}
          {lines.length > 0 ? (
            <ItemDescription className="font-mono text-xs whitespace-pre-line">
              {lines.join("\n")}
            </ItemDescription>
          ) : null}
        </ItemContent>
        <ItemActions>
          {options.map((option) => (
            // Confirmation pattern: Deny outline, Approve filled. eve's
            // `style` hint (primary / danger) wins when it sends one.
            <Button
              key={option.id}
              size="sm"
              variant={optionVariant(
                option.style,
                isAffirmativeOption(option) ? "default" : "outline",
              )}
              disabled={busy}
              title={option.description ?? undefined}
              onClick={() => choose(option)}
            >
              {sentId === option.id ? <CheckIcon /> : null}
              {option.label}
            </Button>
          ))}
        </ItemActions>
      </Item>
    );
  }

  // Question: the prompt is in the message text above; the chips carry the
  // choices, and a free-text answer is allowed when the tool said so.
  const options = parkOptions(request);
  const freeform = onAnswer && (request.allowFreeform || options.length === 0);
  return (
    <div className="flex flex-col gap-2">
      {options.length > 0 ? (
        <div className="scrollbar-none flex scroll-fade-x gap-2 overflow-x-auto overscroll-x-contain">
          {options.map((option) => (
            <Button
              key={option.id}
              variant={sentId === option.id ? "secondary" : optionVariant(option.style, "outline")}
              size="sm"
              className="shrink-0"
              disabled={busy}
              title={option.description ?? undefined}
              onClick={() => choose(option)}
            >
              {sentId === option.id ? <CheckIcon /> : null}
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}
      {freeform ? (
        <form
          className="flex max-w-md items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void answer();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type an answer…"
            disabled={busy}
            className={cn(
              "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          />
          <Button type="submit" size="sm" disabled={busy || !text.trim()}>
            Answer
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function ParkControls({
  requests,
  onChoose,
  onAnswer = null,
  disabled = false,
  className,
}: {
  requests: ParkRequest[];
  /** A tap on an option. Null = read-only (the fleet viewer). */
  onChoose: ParkChoose | null;
  /** A typed answer to a question. Omit when the surface cannot accept one. */
  onAnswer?: ParkAnswer | null;
  disabled?: boolean;
  className?: string;
}) {
  if (requests.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {requests.map((request) => (
        <RequestControl
          key={request.requestId}
          request={request}
          onChoose={onChoose}
          onAnswer={onAnswer}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
