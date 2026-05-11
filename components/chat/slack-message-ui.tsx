"use client";

/**
 * Stream's default MessageUI (v14.1) skips avatars when `message.user` is missing,
 * so system / webhook messages lose the avatar column and row alignment drifts.
 * This fork matches upstream MessageUI.tsx with two Slack-oriented tweaks:
 * - `--with-avatar` + avatar render whenever the avatar column should show (even without user)
 * - placeholder initials via Stream Avatar when there is no user
 * - Slack clustering: avatar + timestamp only on cluster heads (`top` / `single`). Role is
 *   resolved from MessageList `processedMessages` + `getGroupStyles` so it matches Stream’s own grouping.
 *
 * Based on:
 * https://github.com/GetStream/stream-chat-react/blob/v14.1.0/src/components/Message/MessageUI.tsx
 *
 * Stream v14.1 bug/workaround: `<Message>` does not forward `showAvatar` into
 * `MessageProvider`; we always reserve an avatar column for alignment (see below).
 *
 * CSS overrides live in `app/stream-chat-overrides.css` (loaded after Stream CSS).
 */

import clsx from "clsx";
import React, { useContext, useMemo, useState } from "react";
import type { MessageContextValue, MessageUIComponentProps } from "stream-chat-react";
import {
  Attachment as DefaultAttachment,
  Avatar as DefaultAvatar,
  ErrorBadge,
  getGroupStyles,
  isDateSeparatorMessage,
  isIntroMessage,
  MessageListContext,
  MessageActions as DefaultMessageActions,
  MessageAlsoSentInChannelIndicator as DefaultMessageAlsoSentInChannelIndicator,
  MessageBlocked as DefaultMessageBlocked,
  MessageBounceModal,
  MessageBouncePrompt as DefaultMessageBouncePrompt,
  MessageDeletedBubble as DefaultMessageDeletedBubble,
  MessageEditedIndicator as DefaultMessageEditedIndicator,
  MessageReactions as DefaultMessageReactions,
  MessageRepliesCountButton as DefaultMessageRepliesCountButton,
  MessageStatus as DefaultMessageStatus,
  MessageText,
  MessageTimestamp as DefaultMessageTimestamp,
  MessageTranslationIndicator as DefaultMessageTranslationIndicator,
  PinIndicator as DefaultPinIndicator,
  Poll,
  QuotedMessage as DefaultQuotedMessage,
  ReminderNotification as DefaultReminderNotification,
  StreamedMessageText as DefaultStreamedMessageText,
  useChatContext,
  useComponentContext,
  useMessageContext,
  useMessageReminder,
  useTranslationContext,
  areMessageUIPropsEqual,
  countEmojis,
  isMessageBlocked,
  isMessageBounced,
  isMessageDeleted,
  isMessageEdited,
  isMessageErrorRetryable,
  messageHasAttachments,
  messageHasGiphyAttachment,
  messageHasQuotedMessage,
  messageHasReactions,
  messageHasSingleAttachment,
  messageTextHasEmojisOnly,
} from "stream-chat-react";

type ClusterRole = "top" | "middle" | "bottom" | "single";

function neighborRenderedMessage(
  list: unknown[],
  startIdx: number,
  delta: -1 | 1,
): unknown | undefined {
  for (let i = startIdx + delta; delta > 0 ? i < list.length : i >= 0; i += delta) {
    const item = list[i];
    if (!item || typeof item !== "object") continue;
    if (isDateSeparatorMessage(item) || isIntroMessage(item)) continue;
    return item;
  }
  return undefined;
}

function resolveClusterRole(
  messageId: string,
  processedMessages: unknown[] | undefined,
  groupStyles?: string[],
): ClusterRole {
  const fromProp = groupStyles?.[0];
  if (
    fromProp === "top" ||
    fromProp === "middle" ||
    fromProp === "bottom" ||
    fromProp === "single"
  ) {
    return fromProp;
  }

  if (!processedMessages?.length) return "single";

  const idx = processedMessages.findIndex((item) => {
    if (!item || typeof item !== "object") return false;
    if (isDateSeparatorMessage(item) || isIntroMessage(item)) return false;
    return "id" in item && (item as { id?: string }).id === messageId;
  });

  if (idx < 0) return "single";

  const self = processedMessages[idx];
  if (
    !self ||
    typeof self !== "object" ||
    isDateSeparatorMessage(self) ||
    isIntroMessage(self)
  ) {
    return "single";
  }

  const style = getGroupStyles(
    self as never,
    neighborRenderedMessage(processedMessages, idx, -1) as never,
    neighborRenderedMessage(processedMessages, idx, 1) as never,
    false,
    undefined,
  );

  if (
    style === "top" ||
    style === "middle" ||
    style === "bottom" ||
    style === "single"
  ) {
    return style;
  }

  return "single";
}

type MessageUIWithContextProps = MessageContextValue;

const SlackMessageUIWithContext = ({
  endOfGroup,
  firstOfGroup,
  groupStyles,
  groupedByUser,
  handleAction,
  handleOpenThread,
  highlighted,
  isMessageAIGenerated,
  isMyMessage,
  message,
  onUserClick,
  onUserHover,
  renderText,
  threadList,
}: MessageUIWithContextProps) => {
  const messageListCtx = useContext(MessageListContext);
  const processedMessages = messageListCtx?.processedMessages;

  const { client } = useChatContext();
  const { t } = useTranslationContext("MessageUI");
  const [isBounceDialogOpen, setIsBounceDialogOpen] = useState(false);
  const reminder = useMessageReminder(message.id);

  const {
    Attachment = DefaultAttachment,
    Avatar = DefaultAvatar,
    MessageActions = DefaultMessageActions,
    MessageAlsoSentInChannelIndicator = DefaultMessageAlsoSentInChannelIndicator,
    MessageBlocked = DefaultMessageBlocked,
    MessageBouncePrompt = DefaultMessageBouncePrompt,
    MessageDeleted,
    MessageDeletedBubble = DefaultMessageDeletedBubble,
    MessageEditedIndicator = DefaultMessageEditedIndicator,
    MessageReactions = DefaultMessageReactions,
    MessageRepliesCountButton = DefaultMessageRepliesCountButton,
    MessageStatus = DefaultMessageStatus,
    MessageTimestamp = DefaultMessageTimestamp,
    MessageTranslationIndicator = DefaultMessageTranslationIndicator,
    PinIndicator = DefaultPinIndicator,
    QuotedMessage = DefaultQuotedMessage,
    ReminderNotification = DefaultReminderNotification,
    StreamedMessageText = DefaultStreamedMessageText,
  } = useComponentContext("SlackMessageUI");

  const isAIGenerated = useMemo(
    () => isMessageAIGenerated?.(message),
    [isMessageAIGenerated, message],
  );
  const isDeleted = isMessageDeleted(message);

  const finalAttachments = useMemo(
    () =>
      !message.shared_location && !message.attachments
        ? []
        : !message.shared_location
          ? message.attachments
          : [message.shared_location, ...(message.attachments ?? [])],
    [message],
  );

  if (isDateSeparatorMessage(message)) {
    return null;
  }

  if (MessageDeleted && isDeleted) {
    return <MessageDeleted message={message} />;
  }

  if (isMessageBlocked(message)) {
    return <MessageBlocked />;
  }

  const poll = message.poll_id && client.polls.fromState(message.poll_id);

  const hasAttachment = !isDeleted && messageHasAttachments(message);
  const hasSingleAttachment = !isDeleted && messageHasSingleAttachment(message);
  const hasGiphyAttachment = !isDeleted && messageHasGiphyAttachment(message);
  const hasReactions = !isDeleted && messageHasReactions(message);
  const hasQuotedMessage = !isDeleted && messageHasQuotedMessage(message);
  const textHasEmojisOnly = !isDeleted && messageTextHasEmojisOnly(message);

  const allowRetry = isMessageErrorRetryable(message);
  const isBounced = isMessageBounced(message);
  const isEdited = isMessageEdited(message) && !isAIGenerated;

  const clusterRole = useMemo(
    () => resolveClusterRole(message.id, processedMessages, groupStyles),
    [message.id, processedMessages, groupStyles],
  );

  const showMetadata = clusterRole !== "middle" && clusterRole !== "bottom";
  const avatarHiddenInCluster = clusterRole === "middle" || clusterRole === "bottom";

  /** Slack shell always reserves the gutter (Stream often drops `showAvatar` from context). */
  const showAvatarColumn = true;

  const showReplyCountButton = !threadList && !!message.reply_count;

  const rootClassName = clsx(
    "str-chat__message",
    `str-chat__message--${message.type}`,
    `str-chat__message--${message.status}`,
    {
      "str-chat__message--has-attachment": hasAttachment,
      "str-chat__message--has-giphy-attachment": hasGiphyAttachment,
      "str-chat__message--has-no-text": !message.text,
      "str-chat__message--has-quoted-message": hasQuotedMessage,
      "str-chat__message--has-single-attachment": hasSingleAttachment,
      "str-chat__message--has-text": !!message.text,
      "str-chat__message--highlighted": highlighted,
      "str-chat__message--is-emoji-only": textHasEmojisOnly,
      [`str-chat__message--is-emoji-only-count-${countEmojis(message.text)}`]:
        textHasEmojisOnly,
      "str-chat__message--me": isMyMessage(),
      "str-chat__message--other": !isMyMessage(),
      "str-chat__message--pinned": message.pinned,
      "str-chat__message--with-avatar": showAvatarColumn,
      "str-chat__message--with-reactions": hasReactions,
      "str-chat__message-send-can-be-retried":
        message?.status === "failed" && message?.error?.status !== 403,
      "str-chat__message-with-thread-link": showReplyCountButton,
      "str-chat__virtual-message__wrapper--end": endOfGroup,
      "str-chat__virtual-message__wrapper--first": firstOfGroup,
      "str-chat__virtual-message__wrapper--group": groupedByUser,
    },
  );

  let handleClick: (() => void) | undefined;

  if (isBounced) {
    handleClick = () => setIsBounceDialogOpen(true);
  }

  const isMessageInnerInteractive = !!handleClick;
  const messageInnerAriaLabel = isMessageInnerInteractive
    ? t("aria/Review bounced message")
    : undefined;

  const handleMessageInnerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!handleClick || (event.key !== "Enter" && event.key !== " ")) return;

    event.preventDefault();
    handleClick();
  };

  const avatarUserName =
    message.user?.name || message.user?.id || "Unknown";

  const metadataDisplayName = isMyMessage()
    ? (message.user?.name ??
      client.user?.name ??
      client.userID ??
      "You")
    : avatarUserName;

  return (
    <>
      {isBounceDialogOpen && (
        <MessageBounceModal
          MessageBouncePrompt={MessageBouncePrompt}
          onClose={() => setIsBounceDialogOpen(false)}
          open={isBounceDialogOpen}
        />
      )}
      <div
        className={rootClassName}
        data-slack-cluster={clusterRole}
        key={message.id}
      >
        {message.pinned && <PinIndicator message={message} />}
        {message.show_in_channel && <MessageAlsoSentInChannelIndicator />}
        {!!reminder && <ReminderNotification reminder={reminder} />}
        <MessageTranslationIndicator message={message} />
        {showAvatarColumn && (
          <Avatar
            className="str-chat__avatar--with-border"
            imageUrl={message.user?.image}
            onClick={message.user ? onUserClick : undefined}
            onMouseOver={message.user ? onUserHover : undefined}
            size="md"
            style={{ visibility: avatarHiddenInCluster ? "hidden" : "visible" }}
            userName={avatarUserName}
          />
        )}
        {showMetadata ? (
          <div
            className="str-chat__message-metadata"
            style={{
              alignItems: "baseline",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
            }}
          >
            <MessageStatus />
            {showAvatarColumn && (
              <span className="str-chat__message-metadata__name">
                {metadataDisplayName}
              </span>
            )}
            <MessageTimestamp customClass="str-chat__message-metadata__timestamp" />
            {!isDeleted && isEdited && <MessageEditedIndicator />}
          </div>
        ) : null}
        <div
          aria-label={messageInnerAriaLabel}
          className={clsx("str-chat__message-inner", {
            "str-chat__message-inner--error": allowRetry || isBounced,
          })}
          data-testid="message-inner"
          onClick={handleClick}
          onKeyDown={isMessageInnerInteractive ? handleMessageInnerKeyDown : undefined}
          role={isMessageInnerInteractive ? "button" : undefined}
          tabIndex={isMessageInnerInteractive ? 0 : undefined}
        >
          {!isDeleted && <MessageActions />}
          {showReplyCountButton && (
            <MessageRepliesCountButton
              onClick={handleOpenThread}
              reply_count={message.reply_count}
              thread_participants={message.thread_participants}
            />
          )}
          {isDeleted ? (
            <MessageDeletedBubble />
          ) : (
            <>
              <div className="str-chat__message-bubble">
                {poll && <Poll poll={poll} />}
                {message.quoted_message && <QuotedMessage />}
                {finalAttachments?.length ? (
                  <Attachment
                    actionHandler={handleAction}
                    attachments={finalAttachments}
                  />
                ) : null}
                {isAIGenerated ? (
                  <StreamedMessageText message={message} renderText={renderText} />
                ) : (
                  <MessageText message={message} renderText={renderText} />
                )}
              </div>
              <div className="str-chat__message-reactions-host">
                {hasReactions && <MessageReactions reverse />}
              </div>
              <div className="str-chat__message-error-indicator">
                <ErrorBadge />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

const MemoizedSlackMessageUI = React.memo(
  SlackMessageUIWithContext,
  areMessageUIPropsEqual,
) as typeof SlackMessageUIWithContext;

export function SlackMessageUI(props: MessageUIComponentProps) {
  const messageContext = useMessageContext("SlackMessageUI");

  return <MemoizedSlackMessageUI {...messageContext} {...props} />;
}
