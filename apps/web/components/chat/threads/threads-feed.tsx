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
import { Gi } from "@/components/gr8r/icon";
import { JumpToLatestOverride } from "../jump-to-latest";
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

  if (!ready && threads.length === 0) return <ThreadsLoading />;

  if (threads.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">
          <div className="glyph">
            <Gi icon={MessageSquareText} size={20} />
          </div>
          <h2 className="es-h">No threads yet</h2>
          <p>Replies to channel messages show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="threads-feed stack">
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}
    </div>
  );
}

/** gr8r `.panel` shimmer cards while the ThreadManager loads. */
export function ThreadsLoading() {
  return (
    <div className="stack" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="panel">
          <div className="panel-h">
            <span className="sk" style={{ width: 120, height: 11 }} />
          </div>
          <div className="panel-b" style={{ display: "grid", gap: 8 }}>
            <span className="sk" style={{ width: "60%", height: 11 }} />
            <span className="sk" style={{ width: "80%", height: 11 }} />
          </div>
        </div>
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
      <JumpToLatestOverride>
        <ThreadCardContent />
      </JumpToLatestOverride>
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
    <article className="panel" style={{ overflow: "hidden" }}>
      <header className="panel-h" style={{ borderBottom: "1px solid var(--g8-divider)" }}>
        <Gi icon={Icon} size={14} />
        <h2 className="trunc">{channelName}</h2>
        {replyCount > 0 ? (
          <span className="acts">
            <span className="badge gray">
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </span>
          </span>
        ) : null}
      </header>
      {/* SlackThread renders the parent + replies flat — same MessageList,
          parent at index 0, no nested ThreadHead treatment. That's the
          whole point of the threads feed: a flat conversation per card. */}
      <div style={{ paddingBlock: 6 }}>
        <SlackThread hideHeader flatMessages />
      </div>
    </article>
  );
}
