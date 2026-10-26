import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { LocalMessage } from "stream-chat";
import { useChannelContext, useMessageContext, type MessageTextProps } from "stream-chat-expo";
import {
  displayReplyText,
  isMessageRequests,
  isSummarySteps,
  isTurnUsage,
  type ParkRequest,
} from "@hotelclaw/chat-ui/turn";
import { ContextMeter } from "./ContextMeter";
import { Markdown } from "./Markdown";
import { ParkControls } from "./ParkControls";
import { ReplyActions } from "./ReplyActions";
import { TurnTrace } from "./TurnTrace";

/**
 * A channel-bot reply as an agent turn — the phone twin of
 * `apps/web/components/ai/agent-turn/bot-reply.tsx`, split into the three
 * slots stream-chat-expo gives a message (see CustomAttachments.tsx for the
 * override mechanism):
 *
 *   MessageContentTopView  → `BotReplyTrace`   — the steps (TurnTrace).
 *   MessageText            → `BotMessageText`  — the reply through our
 *                            Markdown, with the runtime's fallback
 *                            "Approval needed" block stripped because the
 *                            Confirmation card below replaces it.
 *   MessageContentBottomView (inside CustomAttachmentList) →
 *                            `BotReplyControls` — ParkControls, then copy ·
 *                            👍/👎 · the context meter.
 *
 * Everything keys off the fields the runtime stamps on the message
 * (`eve_turn`, `eve_steps`, `eve_requests`, `eve_usage`), so a message from
 * an older runtime degrades to text + cards with no trace. When someone
 * answers a park, the runtime edits `eve_requests` on the message and
 * Stream's message.updated lands here, so the card settles for every reader.
 */

type BotMessage = LocalMessage & {
  ai_generated?: unknown;
  eve_turn?: unknown;
  eve_steps?: unknown;
  eve_requests?: unknown;
  eve_usage?: unknown;
};

export function isBotMessage(message: LocalMessage): boolean {
  const m = message as BotMessage;
  return m.ai_generated === true || typeof m.eve_turn === "string";
}

export function botRequests(message: LocalMessage): ParkRequest[] {
  const value = (message as BotMessage).eve_requests;
  return isMessageRequests(value) ? value : [];
}

/** The trace above the reply (MessageContentTopView). */
export function BotReplyTrace() {
  const { message } = useMessageContext();
  const { channel } = useChannelContext();
  if (!message || !isBotMessage(message)) return null;
  const m = message as BotMessage;
  const turnNonce = typeof m.eve_turn === "string" ? m.eve_turn : null;
  const summary = isSummarySteps(m.eve_steps) ? m.eve_steps : null;
  if (!summary && !turnNonce) return null;
  const channelId = channel.id ?? null;
  return (
    <View style={styles.top}>
      <TurnTrace
        summary={summary}
        fetchKey={channelId && turnNonce ? { channelId, turnNonce } : null}
      />
    </View>
  );
}

/** The reply text (MessageText override). Non-bot messages keep Stream's
 *  own renderer — mentions, links, long-press — untouched. */
export function BotMessageText(props: MessageTextProps) {
  const { message, renderText, theme } = props;
  if (!message) return null;
  if (!isBotMessage(message)) {
    const {
      theme: {
        messageItemView: {
          content: {
            markdown,
            textContainer: { onlyEmojiMarkdown },
          },
        },
        semantics,
      },
    } = theme;
    return (
      <>
        {renderText({
          isMyMessage: props.isMyMessage,
          semantics,
          markdownRules: props.markdownRules,
          markdownStyles: {
            ...markdown,
            ...(props.markdownStyles ?? {}),
            ...(props.onlyEmojis ? onlyEmojiMarkdown : {}),
          },
          message,
          messageOverlay: props.messageOverlay,
          messageTextNumberOfLines: props.messageTextNumberOfLines,
          onLongPress: props.onLongPress,
          onlyEmojis: props.onlyEmojis,
          onPress: props.onPress,
          preventPress: props.preventPress,
        })}
      </>
    );
  }
  const text = displayReplyText(message.text ?? "", botRequests(message));
  if (!text) return null;
  return (
    <Pressable
      disabled={props.preventPress}
      onPress={(event) => props.onPress?.({ emitter: "messageContent", event })}
      onLongPress={(event) => props.onLongPress?.({ emitter: "messageContent", event })}
      style={styles.text}
    >
      <Markdown>{text}</Markdown>
    </Pressable>
  );
}

/** Park controls + footer (rendered by CustomAttachmentList's bottom slot). */
export function BotReplyControls() {
  const { message } = useMessageContext();
  const { channel } = useChannelContext();
  if (!message || !isBotMessage(message)) return null;
  const m = message as BotMessage;
  const requests = botRequests(message);
  const usage = isTurnUsage(m.eve_usage) ? m.eve_usage : null;
  const text = displayReplyText(message.text ?? "", requests);
  const propertyId =
    typeof channel.data?.property_id === "string" ? channel.data.property_id : null;
  // Background-job parks route by the question message's own thread (the
  // Options card carries `reply_to_self`); otherwise the reply goes beside
  // the bot message — into its thread when it lives in one.
  const replyToSelf = (message.attachments ?? []).some(
    (a) => (a as { reply_to_self?: unknown }).reply_to_self === true,
  );
  const parentId = replyToSelf ? message.id : message.parent_id;
  const reply = async (value: string) => {
    await channel.sendMessage({
      text: value,
      ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
    });
  };

  if (requests.length === 0 && !text) return null;
  return (
    <View style={styles.controls}>
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
        >
          {usage ? <ContextMeter usage={usage} /> : null}
        </ReplyActions>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 8, paddingTop: 4, alignSelf: "stretch" },
  text: { paddingHorizontal: 8, paddingVertical: 2 },
  controls: { gap: 8, alignSelf: "stretch" },
});
