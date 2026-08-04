"use client";

import { AiChat, type AiChatComponentsEmptyProps } from "@liveblocks/react-ui";
import { useSendAiMessage } from "@liveblocks/react";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";

const COPILOT_ID = process.env.NEXT_PUBLIC_LIVEBLOCKS_COPILOT_ID;

/**
 * Slide-over chat panel anchored to the right edge of the calendar.
 *
 * `chatId` is `<propertyId>:<userId>` so each user keeps a personal chat
 * thread per property — your AI history doesn't leak to teammates, but it
 * stays specific to *this* calendar's context (other properties have
 * their own thread).
 *
 * Knowledge + tools register globally on the page via
 * `<RegisterAiKnowledge>` / `<RegisterAiTool>` in `calendar-ai-knowledge`
 * and `calendar-ai-tools`. The chat picks them up automatically when the
 * AI calls a tool or references room context.
 */
export function CalendarAiPanel({
  propertyId,
  currentUserId,
  open,
  onClose,
}: {
  propertyId: string;
  currentUserId: string;
  open: boolean;
  onClose: () => void;
}) {
  const chatId = `calendar:${propertyId}:${currentUserId}`;
  return (
    <div
      className={cn(
        // A docked panel, not a floating one: it separates from the grid by
        // a single warm rule, and carries no elevation.
        "absolute inset-y-0 right-0 z-40 flex w-96 flex-col border-l border-border bg-card transition-transform duration-200",
        open ? "translate-x-0" : "translate-x-full",
      )}
      aria-hidden={!open}
    >
      <div className="flex h-11 items-center justify-between gap-2 border-b border-border px-3">
        <div className="text-sm font-medium text-secondary-ink">
          Calendar assistant
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="rounded-md p-1.5 text-faint-foreground transition-colors hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <AiChat
          chatId={chatId}
          copilotId={COPILOT_ID || undefined}
          className="grow"
          components={{ Empty }}
          layout="compact"
          autoFocus
        />
      </div>
    </div>
  );
}

function Empty({ chatId }: AiChatComponentsEmptyProps) {
  const send = useSendAiMessage(chatId, { copilotId: COPILOT_ID || undefined });
  const suggestions = [
    "Schedule a 30-min sync with the team tomorrow morning",
    "Find a free 1-hour slot this week",
    "Move my 2pm meeting to Friday",
    "What's on my calendar Thursday?",
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <CalendarDays className="size-5 text-faint-foreground" />
      <div>
        <div className="text-sm font-medium">Plan your week with Claude</div>
        <div className="mt-1 text-sm text-muted-foreground text-pretty">
          Create, edit, or find time on the calendar — in natural language.
        </div>
      </div>
      <div className="flex w-full flex-col gap-1">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            className="rounded-md bg-muted px-3 py-2 text-left text-sm text-secondary-ink transition-colors hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
