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
 * - Continuation rows (`middle` / `bottom`): short clock in the avatar gutter on
 *   row hover / focus / open actions, matching Slack.
 *   `.str-chat__slack-message-actions-host` (top-end of the message block) so
 *   it renders as a compact pill on hover, matching Slack, instead of a grid
 *   column beside the bubble.
 *
 * CSS overrides live in `app/stream-chat-overrides.css` (loaded after Stream CSS).
 *
 * Metadata + bubble sit in `.str-chat__slack-message-main` (single grid column beside the avatar)
 * so vertical rhythm matches Slack: tight stack + explicit `grid-area: avatar` (nested `.message-inner`
 * breaks Stream’s `Avatar:has(~ .message-inner)` placement rule).
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
  MessageAlsoSentInChannelIndicator as DefaultMessageAlsoSentInChannelIndicator,
  MessageBlocked as DefaultMessageBlocked,
  MessageBounceModal,
  MessageBouncePrompt as DefaultMessageBouncePrompt,
  MessageDeletedBubble as DefaultMessageDeletedBubble,
  MessageEditedIndicator as DefaultMessageEditedIndicator,
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
import { SlackAddReactionPill } from "@/components/chat/slack-add-reaction-pill";
import { SlackMessageActions } from "@/components/chat/slack-message-actions";
import { SlackMessageReactions } from "@/components/chat/slack-message-reactions";
import { SlackReplyIndicator } from "@/components/chat/slack-reply-indicator";
import { useUserProfilePanel } from "@/components/chat/user-profile-panel/context";
import { useTimeFormat } from "@/lib/preferences/time-format-context";

type ClusterRole = "top" | "middle" | "bottom" | "single";

/**
 * Slack breaks message clusters when consecutive same-author messages are more
 * than ~2 min apart. Exported so `channel-view.tsx` can pass the same value to
 * `<MessageList maxTimeBetweenGroupedMessages>` — Stream's internal
 * groupStyles drives the `.str-chat__li--middle/--bottom` classes that
 * `stream-chat-overrides.css` keys off (with `!important`), so the
 * `<MessageList>` prop and our custom recomputation must agree on the gap.
 */
export const CLUSTER_TIME_GAP_MS = 2 * 60 * 1000;

function messageCreatedAtMs(msg: unknown): number | null {
  if (!msg || typeof msg !== "object") return null;
  const createdAt = (msg as { created_at?: unknown }).created_at;
  if (createdAt == null) return null;
  const d =
    createdAt instanceof Date
      ? createdAt
      : typeof createdAt === "string"
        ? new Date(createdAt)
        : new Date(String(createdAt));
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Demote the cluster role when the time gap to a same-author neighbor exceeds
 * the threshold, so a re-engaged user gets a fresh avatar/header row.
 */
function demoteClusterRoleByTimeGap(
  role: ClusterRole,
  self: unknown,
  prev: unknown,
  next: unknown,
): ClusterRole {
  const selfMs = messageCreatedAtMs(self);
  if (selfMs == null) return role;

  let result = role;

  if (result === "middle" || result === "bottom") {
    const prevMs = messageCreatedAtMs(prev);
    if (prevMs != null && selfMs - prevMs > CLUSTER_TIME_GAP_MS) {
      result = result === "middle" ? "top" : "single";
    }
  }

  if (result === "top" || result === "middle") {
    const nextMs = messageCreatedAtMs(next);
    if (nextMs != null && nextMs - selfMs > CLUSTER_TIME_GAP_MS) {
      result = result === "top" ? "single" : "bottom";
    }
  }

  return result;
}

/** Short clock for Slack-style gutter (continuation rows). The `hour12` flag
 *  is driven by the user's per-profile preference; default is 24-hour. */
function slackGutterTimeFromMessage(
  createdAt: unknown,
  hour12: boolean,
): {
  label: string;
  iso: string;
} | null {
  if (createdAt == null) return null;
  const d =
    createdAt instanceof Date
      ? createdAt
      : typeof createdAt === "string"
        ? new Date(createdAt)
        : new Date(String(createdAt));
  if (Number.isNaN(d.getTime())) return null;
  const label = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
  }).format(d);
  return { label, iso: d.toISOString() };
}

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

/**
 * Stream's getGroupStyles treats any message with reactions as a cluster
 * breaker — both the reacted message and its successor get forced into
 * `single`/`top`/`bottom`, growing an avatar. Slack's grouping ignores
 * reactions entirely; reactions sit under the reacted message without
 * splitting the cluster. Strip `reaction_groups` before handing the message
 * to getGroupStyles so the algorithm can't see the reaction signal — every
 * other rule (author change, attachments, type, edited) still applies.
 */
function withoutReactions(msg: unknown): unknown {
  if (!msg || typeof msg !== "object") return msg;
  return { ...(msg as Record<string, unknown>), reaction_groups: undefined };
}

function resolveClusterRole(
  messageId: string,
  processedMessages: unknown[] | undefined,
): ClusterRole {
  let self: unknown;
  let prev: unknown;
  let next: unknown;

  if (processedMessages?.length) {
    const idx = processedMessages.findIndex((item) => {
      if (!item || typeof item !== "object") return false;
      if (isDateSeparatorMessage(item) || isIntroMessage(item)) return false;
      return "id" in item && (item as { id?: string }).id === messageId;
    });

    if (idx >= 0) {
      const candidate = processedMessages[idx];
      if (
        candidate &&
        typeof candidate === "object" &&
        !isDateSeparatorMessage(candidate) &&
        !isIntroMessage(candidate)
      ) {
        self = candidate;
        prev = neighborRenderedMessage(processedMessages, idx, -1);
        next = neighborRenderedMessage(processedMessages, idx, 1);
      }
    }
  }

  let role: ClusterRole = "single";

  // The `groupStyles` prop from Stream's MessageList is computed against
  // un-stripped messages, so it carries the reaction-as-cluster-breaker bug.
  // Always recompute locally with reactions stripped.
  if (self) {
    const style = getGroupStyles(
      withoutReactions(self) as never,
      withoutReactions(prev) as never,
      withoutReactions(next) as never,
      false,
      // Tell Stream's helper to break clusters at the same gap the
      // `<MessageList maxTimeBetweenGroupedMessages>` prop uses, so our
      // custom recomputation can't disagree with the li-class CSS overrides.
      // `demoteClusterRoleByTimeGap` below stays as a safety net.
      CLUSTER_TIME_GAP_MS,
    );
    if (
      style === "top" ||
      style === "middle" ||
      style === "bottom" ||
      style === "single"
    ) {
      role = style;
    }
  }

  if (!self) return role;

  return demoteClusterRoleByTimeGap(role, self, prev, next);
}

type MessageUIWithContextProps = MessageContextValue;

const SlackMessageUIWithContext = ({
  endOfGroup,
  firstOfGroup,
  groupedByUser,
  handleAction,
  handleOpenThread,
  highlighted,
  isMessageAIGenerated,
  isMyMessage,
  message,
  onUserClick,
  renderText,
  threadList,
}: MessageUIWithContextProps) => {
  const messageListCtx = useContext(MessageListContext);
  const processedMessages = messageListCtx?.processedMessages;

  const { client } = useChatContext();
  const { t } = useTranslationContext("MessageUI");
  const [isBounceDialogOpen, setIsBounceDialogOpen] = useState(false);
  const reminder = useMessageReminder(message.id);
  const profilePanel = useUserProfilePanel();
  const openProfile = message.user?.id
    ? () => profilePanel.open(message.user!.id!)
    : undefined;

  const {
    Attachment = DefaultAttachment,
    Avatar = DefaultAvatar,
    MessageAlsoSentInChannelIndicator = DefaultMessageAlsoSentInChannelIndicator,
    MessageBlocked = DefaultMessageBlocked,
    MessageBouncePrompt = DefaultMessageBouncePrompt,
    MessageDeleted,
    MessageDeletedBubble = DefaultMessageDeletedBubble,
    MessageEditedIndicator = DefaultMessageEditedIndicator,
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

  const clusterRole = useMemo(
    () => resolveClusterRole(message.id, processedMessages),
    [message.id, processedMessages],
  );

  const { format: timeFormat } = useTimeFormat();
  const hour12 = timeFormat === "12h";

  const slackGutterTime = useMemo(() => {
    if (clusterRole !== "middle" && clusterRole !== "bottom") return null;
    // The hover gutter time is always 24h regardless of the user's preference —
    // it's a compact clock label squeezed into the avatar column where AM/PM
    // would overflow into the message text.
    return slackGutterTimeFromMessage(message.created_at, false);
  }, [clusterRole, message.created_at]);

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
        data-slack-reactions={hasReactions ? "bottom" : undefined}
        key={message.id}
      >
        {message.pinned && <PinIndicator message={message} />}
        {message.show_in_channel && <MessageAlsoSentInChannelIndicator />}
        {!!reminder && <ReminderNotification reminder={reminder} />}
        <MessageTranslationIndicator message={message} />
        {showAvatarColumn && (
          <>
            <Avatar
              className="str-chat__avatar--with-border"
              imageUrl={message.user?.image}
              onClick={openProfile ?? onUserClick}
              size="md"
              style={{ visibility: avatarHiddenInCluster ? "hidden" : "visible" }}
              userName={avatarUserName}
            />
            {slackGutterTime && !isDeleted ? (
              <time
                className="str-chat__slack-gutter-timestamp"
                dateTime={slackGutterTime.iso}
                title={slackGutterTime.iso}
              >
                {slackGutterTime.label}
              </time>
            ) : null}
          </>
        )}
        <div className="str-chat__slack-message-main">
          {showMetadata ? (
            <div className="str-chat__message-metadata">
              {showAvatarColumn && (
                openProfile ? (
                  <button
                    type="button"
                    onClick={openProfile}
                    className="str-chat__message-metadata__name hover:underline"
                  >
                    {metadataDisplayName}
                  </button>
                ) : (
                  <span className="str-chat__message-metadata__name">
                    {metadataDisplayName}
                  </span>
                )
              )}
              <MessageTimestamp
                customClass="str-chat__message-metadata__timestamp"
                format={hour12 ? "h:mm A" : "HH:mm"}
              />
              {!isDeleted && isEdited && <MessageEditedIndicator />}
              <MessageStatus />
            </div>
          ) : null}
          {!isDeleted ? (
            <div className="str-chat__slack-message-actions-host">
              <SlackMessageActions />
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
            {showReplyCountButton && (
              <SlackReplyIndicator
                replyCount={message.reply_count ?? 0}
                participants={message.thread_participants}
                // Stream's `LocalMessage` doesn't carry a real "last reply at"
                // timestamp on the parent (that lives on `ThreadResponse` from
                // the threads v2 API). Fall back to the parent's `created_at`
                // so the row always renders "Last reply X ago" — same shape as
                // Slack. Wire up `client.queryThreads()` later if precision matters.
                lastReplyAt={message.created_at}
                onClick={handleOpenThread as React.MouseEventHandler<HTMLButtonElement>}
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
                  {hasReactions ? (
                    <>
                      <SlackMessageReactions
                        reverse
                        verticalPosition="bottom"
                        visualStyle="segmented"
                      />
                      <SlackAddReactionPill />
                    </>
                  ) : null}
                </div>
                <div className="str-chat__message-error-indicator">
                  <ErrorBadge />
                </div>
              </>
            )}
          </div>
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
