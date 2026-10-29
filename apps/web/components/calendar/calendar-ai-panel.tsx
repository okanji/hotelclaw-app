"use client";

import { AiChat, type AiChatComponentsEmptyProps } from "@liveblocks/react-ui";
import { useSendAiMessage } from "@liveblocks/react";
import { CalendarDays, Sparkles, X } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
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
        // gr8r's drawer edge (surface + hairline + the pop shadow),
        // docked inside the calendar surface rather than fixed to the page.
        "absolute inset-y-0 right-0 z-40 flex w-96 flex-col transition-transform duration-200",
        open ? "translate-x-0" : "translate-x-full",
      )}
      style={{
        background: "var(--g8-surface)",
        borderLeft: "1px solid var(--g8-border)",
        boxShadow: open ? "var(--g8-shadow-pop)" : undefined,
      }}
      aria-hidden={!open}
    >
      <div className="drawer-h">
        <Gi icon={Sparkles} size={14} />
        <span style={{ fontWeight: 600, fontSize: "var(--g8-fs-sm)", marginLeft: 4 }}>
          Calendar assistant
        </span>
        <span className="sp" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="ibtn ibtn-sm"
        >
          <Gi icon={X} size={15} />
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
    // gr8r `.empty-state` + suggestion rows as `.mi` menu items.
    <div className="empty-state sm h-full justify-center">
      <span className="glyph">
        <Gi icon={CalendarDays} size={22} />
      </span>
      <h3 className="es-h">Plan your week with Claude</h3>
      <p>Create, edit, or find time on the calendar — in natural language.</p>
      <div className="flex w-full flex-col gap-0.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            className="mi"
            style={{
              whiteSpace: "normal",
              minHeight: 36,
              background: "var(--g8-surface-2)",
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
