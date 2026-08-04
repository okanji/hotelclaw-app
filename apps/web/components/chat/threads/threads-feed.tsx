"use client";

import {
  ThreadProvider,
  useChatContext,
  useStateStore,
  useThreadContext,
  useThreadList,
} from "stream-chat-react";
import type { Thread, ThreadState } from "stream-chat";
import { Hash, Lock, MessageSquare, MessageSquareText } from "lucide-react";
import { SlackThread } from "./slack-thread";

/**
 * Slack-style threads feed for `/threads`. One scrollable column of
 * self-contained thread cards — each card uses Stream's `<ThreadProvider>`
 * (which internally wraps in `<Channel channel={thread.channel}>` AND sets
 * the ThreadContext to this `Thread` instance) so `<SlackThread>` can read
 * the active thread the same way it does inside a channel.
 *
 * The card's header is just a small channel chip; `SlackThread` is told to
 * skip its own default `<ThreadHeader>` so the card layout stays compact.
 */
export function ThreadsFeed() {
  const { client } = useChatContext();
  // Canonical pattern — activates the ThreadManager (runs the reload that
  // populates `state.threads`) and deactivates on unmount + on tab
  // visibility change. Without this the manager stays inert.
  useThreadList();
  const { threads, ready } = useStateStore(client.threads.state, (s) => ({
    threads: s.threads,
    ready: s.ready,
  }));

  if (!ready && threads.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading threads…
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <MessageSquareText className="size-8 opacity-50" />
        <p className="text-sm">No threads yet.</p>
        <p className="text-xs">Replies to channel messages show up here.</p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col divide-y divide-border">
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}
    </div>
  );
}

function ThreadCard({ thread }: { thread: Thread }) {
  // ThreadProvider sets ThreadContext AND wraps in <Channel channel={thread.channel}>
  // — exactly the contexts SlackThread + SlackMessageUI + SlackComposer
  // need to read parent/replies and send replies attached to this thread.
  return (
    <ThreadProvider thread={thread}>
      <ThreadCardContent />
    </ThreadProvider>
  );
}

const cardSelector = (s: ThreadState) => ({
  channel: s.channel,
  replyCount: s.replyCount,
});

function ThreadCardContent() {
  // We're inside ThreadProvider, so the active Thread instance is available.
  const threadInstance = useThreadContext();
  const view = useStateStore(threadInstance?.state, cardSelector);
  if (!view) return null;

  const { channel, replyCount } = view;
  const channelData = channel.data as
    | { name?: string; is_private?: boolean }
    | undefined;
  const channelName = channelData?.name ?? channel.id ?? "channel";
  const isMessaging = channel.type === "messaging";
  const isPrivate = !!channelData?.is_private;
  const Icon = isMessaging ? MessageSquare : isPrivate ? Lock : Hash;

  return (
    <article className="flex w-full flex-col px-8 py-6">
      <header className="mb-3 flex items-center gap-1.5 text-xs font-medium text-faint-foreground">
        <Icon className="size-3" />
        <span className="font-semibold">{channelName}</span>
        {replyCount > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </span>
          </>
        ) : null}
      </header>
      {/* SlackThread renders the parent + replies flat — same MessageList,
          parent at index 0, no nested ThreadHead treatment. That's the
          whole point of the threads feed: a flat conversation per card. */}
      <SlackThread hideHeader flatMessages />
    </article>
  );
}
