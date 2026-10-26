"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { Attachment as DefaultAttachment, type AttachmentProps } from "stream-chat-react";
import type { LocalMessage } from "stream-chat";
import {
  displayReplyText,
  isMessageRequests,
  isSummarySteps,
  isTurnUsage,
  type ParkRequest,
  type SummaryStep,
  type TurnUsage,
} from "@hotelclaw/chat-ui/turn";
import { Markdown } from "@/components/ai/markdown";
import { ReplyActions } from "@/components/ai/reply-actions";
import { useQuickReplySender } from "@/components/chat/use-quick-reply-sender";
import { cn } from "@/lib/utils";
import { ParkControls } from "./park-controls";
import { TurnTrace } from "./turn-trace";
import { TurnUsageMeter } from "./turn-usage";

/**
 * A channel-bot reply, rendered as an agent turn.
 *
 * Order follows the shadcn/ui AI Elements "Chat" pattern for an assistant
 * turn: the steps (Trace) first, then the reply, then anything the turn
 * asks of the reader, then the footer actions:
 *
 *   1. TurnTrace — reasoning, tool calls, subagents, sources (collapsed).
 *   2. Leading attachments — artifact cards the write tools posted.
 *   3. The reply text through `Markdown` (Streamdown + Code Block) instead
 *      of Stream's plain renderer.
 *   4. `ai_ui` cards from render_ui (tables / cards / stats).
 *   5. ParkControls — an open question's chips or an approval's Item;
 *      settled parks read as one line.
 *   6. Copy · 👍 / 👎 (the learning loop) · the Context meter.
 *
 * Everything here keys off fields the runtime stamps on the message
 * (`eve_turn`, `eve_steps`, `eve_requests`, `eve_usage`) plus the
 * `park_request_id` marker on park Options cards, so a message from an older
 * runtime degrades to text + cards with no trace. The phone renders the same
 * fields through `apps/mobile/components/ai/BotReply.tsx`.
 */

type BotMessage = LocalMessage & {
  eve_turn?: unknown;
  eve_steps?: unknown;
  eve_requests?: unknown;
  eve_usage?: unknown;
};

type AiUiAttachment = NonNullable<AttachmentProps["attachments"]>[number] & {
  park_request_id?: string | null;
  reply_to_self?: boolean;
};

export function BotReply({
  message,
  leadingAttachments,
  aiUiAttachments,
  actionHandler,
  Attachment = DefaultAttachment,
  className,
}: {
  message: BotMessage;
  leadingAttachments: NonNullable<AttachmentProps["attachments"]>;
  aiUiAttachments: NonNullable<AttachmentProps["attachments"]>;
  actionHandler?: AttachmentProps["actionHandler"];
  Attachment?: React.ComponentType<AttachmentProps>;
  className?: string;
}) {
  const { send, sendSelfThread, channelId } = useQuickReplySender("BotReply");
  const params = useParams<{ propertyId?: string }>();
  const propertyId = typeof params?.propertyId === "string" ? params.propertyId : null;

  const turnNonce = typeof message.eve_turn === "string" ? message.eve_turn : null;
  const summary: SummaryStep[] | null = isSummarySteps(message.eve_steps) ? message.eve_steps : null;
  const requests: ParkRequest[] = isMessageRequests(message.eve_requests) ? message.eve_requests : [];
  const usage: TurnUsage | null = isTurnUsage(message.eve_usage) ? message.eve_usage : null;

  // Park Options cards are superseded by ParkControls when the message
  // carries structured requests; the generic render_ui cards stay.
  const [cards, parkCards] = useMemo(() => {
    const all = aiUiAttachments as AiUiAttachment[];
    if (requests.length === 0) return [all, [] as AiUiAttachment[]] as const;
    return [
      all.filter((a) => !a.park_request_id),
      all.filter((a) => !!a.park_request_id),
    ] as const;
  }, [aiUiAttachments, requests.length]);
  const replyToSelf = parkCards.some((a) => a.reply_to_self === true);
  // A tap posts the option's LABEL as the person's own channel message
  // (the web glue addresses the parked request by label); background-job
  // parks must land in the bot message's own thread.
  const reply = replyToSelf ? sendSelfThread : send;

  const text = displayReplyText(message.text ?? "", requests);

  return (
    <div className={cn("group/message flex min-w-0 flex-col gap-2", className)}>
      {summary || turnNonce ? (
        <TurnTrace
          summary={summary}
          fetchKey={channelId && turnNonce ? { channelId, turnNonce } : null}
        />
      ) : null}
      {leadingAttachments.length > 0 ? (
        <Attachment actionHandler={actionHandler} attachments={leadingAttachments} />
      ) : null}
      {text ? (
        <div className="str-chat__message-text" data-testid="message-text">
          <Markdown className="str-chat__message-text-inner [&_a]:underline [&_p]:my-0 [&_ul]:my-1 [&_ol]:my-1 [&_pre]:my-2">
            {text}
          </Markdown>
        </div>
      ) : null}
      {cards.length > 0 ? <Attachment actionHandler={actionHandler} attachments={cards} /> : null}
      {requests.length > 0 ? (
        <ParkControls
          requests={requests}
          onChoose={(_request, option) => reply(option.label)}
          onAnswer={(_request, answer) => reply(answer)}
        />
      ) : null}
      {text ? (
        <ReplyActions
          text={text}
          messageKey={message.id}
          feedback={propertyId ? { propertyId, surface: "channel", sessionId: null } : null}
          size="icon-xs"
          revealOnHover
        >
          {usage ? <TurnUsageMeter usage={usage} /> : null}
        </ReplyActions>
      ) : null}
    </div>
  );
}
