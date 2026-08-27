"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ComponentProvider,
  useChannelStateContext,
  useChatContext,
  useComponentContext,
  type ScrollToLatestMessageButtonProps,
} from "stream-chat-react";
import type { Event as StreamEvent } from "stream-chat";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * House replacement for Stream's scroll-to-latest UI. Stock stream-chat-react
 * renders TWO overlapping indicators when you're scrolled up: a non-clickable
 * grey "N new messages" label bottom-center AND a circular arrow button with
 * an overlapping count badge bottom-right. This merges them into one centered
 * control (the ChatGPT/Teams pattern):
 *
 *   - scrolled up, nothing new  → quiet 32px circle, arrow only
 *   - new messages arrive       → grows into a dark pill "N new messages"
 *
 * Both states click through to Stream's own `onClick` (scroll to latest /
 * jump back to the newest message set). The unread count is ported verbatim
 * from Stream's `ScrollToLatestMessageButton` so the semantics (own messages
 * don't count, replies don't count on the main list while a thread is open,
 * thread lists watch `message.updated`) stay identical.
 */
export function JumpToLatest({
  isMessageListScrolledToBottom,
  isNotAtLatestMessageSet = false,
  onClick,
  threadList,
}: ScrollToLatestMessageButtonProps) {
  const { channel, client } = useChatContext();
  const { thread } = useChannelStateContext();
  const [countUnread, setCountUnread] = useState(channel?.countUnread() || 0);
  const [replyCount, setReplyCount] = useState(thread?.reply_count || 0);
  const observedEvent = threadList ? "message.updated" : "message.new";

  useEffect(() => {
    const handleEvent = (event: StreamEvent) => {
      const inAnotherChannel = event.cid !== channel?.cid;
      const isMine = event.user?.id === client.user?.id;
      const isReply = !!event.message?.parent_id;
      // A reply while its thread panel is open is read there, not here.
      const replyReadInOpenThread = !!thread && !threadList && isReply;
      if (
        isMessageListScrolledToBottom ||
        inAnotherChannel ||
        isMine ||
        replyReadInOpenThread
      ) {
        return;
      }
      if (event.type === "message.new") {
        setCountUnread((prev) => prev + 1);
      } else if (event.message?.id === thread?.id) {
        setCountUnread((event.message?.reply_count || 0) - replyCount);
      }
    };
    client.on(observedEvent, handleEvent);
    return () => {
      client.off(observedEvent, handleEvent);
    };
  }, [
    channel,
    client,
    isMessageListScrolledToBottom,
    observedEvent,
    replyCount,
    thread,
    threadList,
  ]);

  // Reset the count on reaching the bottom (and re-baseline the reply count
  // when the open thread changes). Render-time state adjustment instead of an
  // effect — same semantics as Stream's own reset effect, without the
  // cascading-render lint smell.
  const [prevAtBottom, setPrevAtBottom] = useState(
    isMessageListScrolledToBottom,
  );
  const [prevThread, setPrevThread] = useState(thread);
  if (prevAtBottom !== isMessageListScrolledToBottom || prevThread !== thread) {
    setPrevAtBottom(isMessageListScrolledToBottom);
    setPrevThread(thread);
    if (isMessageListScrolledToBottom) {
      setCountUnread(0);
      setReplyCount(thread?.reply_count || 0);
    }
  }

  if (isMessageListScrolledToBottom && !isNotAtLatestMessageSet) return null;

  const hasUnread = countUnread > 0;
  const noun = countUnread === 1 ? "message" : "messages";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-live="polite"
        aria-label={
          hasUnread
            ? `${countUnread} new ${noun} — jump to latest`
            : "Jump to latest message"
        }
        className={cn(
          "ai-fade-up pointer-events-auto relative flex h-8 items-center justify-center rounded-full outline-none focus-visible:shadow-focus",
          hasUnread
            ? "gap-1.5 bg-tooltip-bg pr-3 pl-2.5 text-xs font-medium text-tooltip-foreground shadow-tooltip"
            : "w-8 bg-card text-muted-foreground shadow-overlay hover:bg-accent hover:text-foreground",
        )}
      >
        <ArrowDown className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        {hasUnread ? (
          <span className="tabular-nums">
            {countUnread} new {noun}
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2"
        />
      </button>
    </div>
  );
}

/** The count now lives in the jump pill — the stock label-only banner would
 *  duplicate it dead-center right above the pill. */
function HiddenNewMessageNotification() {
  return null;
}

/**
 * Mount inside a `<Channel>` (or `<ThreadProvider>`) subtree to swap the
 * stock indicators for `JumpToLatest`. Spreads the parent ComponentContext so
 * every other Stream component default survives (ComponentProvider replaces
 * the value wholesale — same pattern as the channel-list LoadingIndicator
 * override).
 */
export function JumpToLatestOverride({ children }: { children: ReactNode }) {
  const parent = useComponentContext();
  return (
    <ComponentProvider
      value={{
        ...parent,
        ScrollToLatestMessageButton: JumpToLatest,
        NewMessageNotification: HiddenNewMessageNotification,
      }}
    >
      {children}
    </ComponentProvider>
  );
}
