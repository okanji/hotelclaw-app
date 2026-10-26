"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, ThumbsDownIcon, ThumbsUpIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageFooter } from "@/components/ui/message";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AiFeedbackInput } from "@/lib/ai/feedback";
import { cn } from "@/lib/utils";
import { recordAiFeedback } from "./feedback-actions";

/**
 * The actions under an AI reply — the shadcn/ui AI Elements "Message"
 * pattern's footer: ghost icon buttons in a Tooltip each, Copy swapping to
 * a check for two seconds, Good / Bad response as `aria-pressed` toggles.
 * One component for the channel bot, the Assistant, agent chats and the
 * panel bots, so the learning loop's thumbs look and behave the same
 * everywhere. A 👎 asks for one line, because the note is what the nightly
 * distiller turns into a durable preference (lib/memory/learn.ts).
 */
export type ReplyFeedbackScope = Pick<AiFeedbackInput, "propertyId" | "surface"> & {
  sessionId?: string | null;
};

export function MessageAction({
  label,
  size = "icon-sm",
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label={label}
            className={cn("text-muted-foreground", className)}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function ReplyActions({
  text,
  messageKey,
  feedback,
  size = "icon-sm",
  revealOnHover = false,
  className,
  children,
}: {
  text: string;
  /** Stable key for the reply (turn index, message id) the feedback row keys on. */
  messageKey: string;
  /** When null, only Copy renders (read-only surfaces). */
  feedback?: ReplyFeedbackScope | null;
  size?: "icon-sm" | "icon-xs";
  /** Fade in on hover of the enclosing `group/message` (the Message primitive). */
  revealOnHover?: boolean;
  className?: string;
  /** Extra footer items — the context meter, "Pin this", … */
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const rate = async (value: 1 | -1, withNote?: string) => {
    if (!feedback) return;
    const next = rating === value && withNote === undefined ? null : value;
    setRating(next);
    if (next === null) {
      setNoteOpen(false);
      return;
    }
    if (value === -1 && withNote === undefined) setNoteOpen(true);
    const result = await recordAiFeedback({
      propertyId: feedback.propertyId,
      surface: feedback.surface,
      sessionId: feedback.sessionId ?? null,
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

  const icon = size === "icon-xs" ? "size-3" : "size-3.5";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <MessageFooter
        data-rated={rating !== null}
        className={cn(
          "-ml-1.5 gap-0.5 px-0",
          revealOnHover &&
            "opacity-50 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 data-[rated=true]:opacity-100",
        )}
      >
        <MessageAction label={copied ? "Copied" : "Copy"} size={size} onClick={copy}>
          {copied ? <CheckIcon className={icon} /> : <CopyIcon className={icon} />}
        </MessageAction>
        {feedback ? (
          <>
            <MessageAction
              label="Good response"
              size={size}
              aria-pressed={rating === 1}
              onClick={() => rate(1)}
              className={cn(rating === 1 && "text-pill-success-ink")}
            >
              <ThumbsUpIcon className={cn(icon, rating === 1 && "fill-current")} />
            </MessageAction>
            <MessageAction
              label="Bad response"
              size={size}
              aria-pressed={rating === -1}
              onClick={() => rate(-1)}
              className={cn(rating === -1 && "text-pill-danger-ink")}
            >
              <ThumbsDownIcon className={cn(icon, rating === -1 && "fill-current")} />
            </MessageAction>
          </>
        ) : null}
        {children}
      </MessageFooter>
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
            <XIcon className="size-3.5" />
          </Button>
        </form>
      ) : null}
    </div>
  );
}
