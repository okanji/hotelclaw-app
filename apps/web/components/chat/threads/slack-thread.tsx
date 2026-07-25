"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  Message,
  MessageList,
  ThreadHeader,
  useChannelActionContext,
  useChannelStateContext,
  useStateStore,
  useThreadContext,
} from "stream-chat-react";
import type { ThreadState } from "stream-chat";
import { cn } from "@/lib/utils";
import { SlackComposer } from "../slack-composer";
import { slackRenderText } from "../slack-render-text";
import { CLUSTER_TIME_GAP_MS, slackGroupStyles } from "../slack-message-ui";

/**
 * Slack-styled `<Thread>` replacement. Mirrors Stream's own `<Thread>` —
 * which we can't reuse because there's no way to swap its built-in
 * MessageComposer for our SlackComposer (no `Input` prop, no
 * ComponentContext slot for the composer).
 *
 * Stream supports two threading APIs, both of which `<Thread>` (and now
 * this component) read from:
 *   1. **Channel-state path** — `channel.state.thread` (the parent
 *      message) and `channel.state.threadMessages` (the replies). Set by
 *      `openThread` + `loadMoreThread` from `ChannelActionContext`. Used
 *      by the inline reply panel that opens off a channel message.
 *   2. **ThreadContext path** — a `Thread` instance with its own
 *      `StateStore` (`parentMessage`, `replies`, pagination). Set by
 *      `<ThreadProvider>` (and by Stream's `ChatView.ThreadAdapter`).
 *      Used by the dedicated /threads feed.
 *
 * The **critical** detail this implementation gets right and the previous
 * one did NOT: `<MessageList>` must be given an explicit `messages` prop
 * — without it the list falls back to `channel.state.messages`, the
 * channel's main feed. That's why the thread panel previously rendered
 * "channel chat."
 */
const threadStateSelector = (s: ThreadState) => ({
  parentMessage: s.parentMessage,
  replies: s.replies,
  isLoadingNext: s.pagination.isLoadingNext,
  isLoadingPrev: s.pagination.isLoadingPrev,
});

export type SlackThreadProps = {
  /** Render this above the message list instead of Stream's default
   *  `<ThreadHeader>`. Useful for the /threads feed where each card has its
   *  own channel-chip header. */
  header?: ReactNode;
  /** Skip the header entirely (the wrapping card provides its own). */
  hideHeader?: boolean;
  /** Render the parent message inline as the first row in the same
   *  MessageList as the replies (instead of via the dedicated `head` slot,
   *  which gives the parent a nested / thread-start treatment). The
   *  /threads feed uses this — its whole point is a flat conversation. */
  flatMessages?: boolean;
};

export function SlackThread({
  header,
  hideHeader,
  flatMessages,
}: SlackThreadProps = {}) {
  const {
    thread,
    threadMessages = [],
    threadHasMore,
    threadLoadingMore,
  } = useChannelStateContext();
  const { closeThread, loadMoreThread } = useChannelActionContext();
  const threadInstance = useThreadContext();

  // The new API stores replies + pagination on a StateStore. `useStateStore`
  // is overloaded to accept an undefined store (returns undefined then), so
  // we can call it unconditionally — same pattern Stream's `<Thread>` uses.
  const threadState = useStateStore(threadInstance?.state, threadStateSelector);

  // Mirrors Stream's Thread: when we're on the channel-state path and the
  // parent has replies, kick `loadMoreThread` so they actually land. (The
  // new-API path manages its own initial load.)
  useEffect(() => {
    if (threadInstance) return;
    if ((thread?.reply_count ?? 0) > 0) {
      loadMoreThread();
    }
  }, [thread, loadMoreThread, threadInstance]);

  // ⚠️ EXPLICIT `messages` prop is the fix for "thread panel shows channel
  // chat." Without it MessageList falls back to channel.state.messages.
  const replies = threadInstance
    ? (threadState?.replies ?? [])
    : threadMessages;
  const parentMessage = thread ?? threadState?.parentMessage;
  // In flat mode, the parent message rides at the head of the same array
  // as the replies — no nested ThreadHead treatment. Otherwise the parent
  // goes through MessageList's `head` slot below. Always call the hook
  // unconditionally so its position in the hook list stays stable across
  // renders where the parent isn't loaded yet (Rules of Hooks).
  const messages = useMemo(
    () =>
      flatMessages && parentMessage
        ? [parentMessage, ...replies]
        : replies,
    [flatMessages, parentMessage, replies],
  );

  if (!parentMessage) return null;

  // Panel mode = inline channel reply panel (side-by-side with the channel
  // column). It needs its own boundary against the main feed and a bit of
  // breathing room above the first message. Flat-feed mode (the /threads
  // page) doesn't — the wrapping card already provides those.
  const panelMode = !hideHeader;

  return (
    <div
      className={cn(
        "str-chat__thread flex h-full min-h-0 flex-col",
        panelMode && "border-l border-border",
      )}
    >
      {hideHeader
        ? null
        : (header ?? (
            <ThreadHeader thread={parentMessage} closeThread={closeThread} />
          ))}
      <div className={cn("min-h-0 flex-1", panelMode && "pt-4")}>
        <MessageList
          threadList
          messages={messages}
          // `head` is Stream's slot for content above the reply list — same
          // mechanism their own `<Thread>` uses to put the parent message at
          // the top with a thread-start treatment. In flat mode (the
          // /threads feed) we skip it; the parent is already at index 0 of
          // `messages` and renders as a regular row.
          head={
            flatMessages ? undefined : (
              <Message message={parentMessage} initialMessage />
            )
          }
          renderText={slackRenderText}
          showAvatar
          disableDateSeparator={false}
          // Same Slack grouping rules as the main channel list (attachments
          // and reactions don't break a cluster; one agent turn = one
          // cluster). Bot replies over Stream's ~5KB limit land here as
          // continuation chunks, so they must group like the channel.
          groupStyles={slackGroupStyles as never}
          maxTimeBetweenGroupedMessages={CLUSTER_TIME_GAP_MS}
          {...(threadInstance
            ? {
                loadMore: threadInstance.loadPrevPage,
                loadMoreNewer: threadInstance.loadNextPage,
                loadingMore: threadState?.isLoadingPrev,
                loadingMoreNewer: threadState?.isLoadingNext,
              }
            : {
                hasMore: threadHasMore,
                loadingMore: threadLoadingMore,
                loadMore: loadMoreThread,
              })}
        />
      </div>
      <SlackComposer />
    </div>
  );
}
