"use client";

import { useEffect } from "react";
import {
  ChatView,
  Thread,
  ThreadList,
  useChatContext,
  useChatViewContext,
} from "stream-chat-react";

/**
 * Slack-style "Threads" view: list of every thread the user participates in
 * across channels (left), and the selected thread on the right. Stream's
 * `<ChatView>` owns the active-thread state, list↔detail wiring, and live
 * updates from `client.threads`.
 *
 * We render inside ChatView and force `activeChatView = "threads"` because
 * Stream defaults to "channels" — this page is dedicated to threads.
 */
export function ThreadsView() {
  return (
    <ChatView>
      <ForceThreadsView />
      <ChatView.Threads>
        <ThreadList />
        <ChatView.ThreadAdapter>
          <Thread />
        </ChatView.ThreadAdapter>
      </ChatView.Threads>
    </ChatView>
  );
}

function ForceThreadsView() {
  const { setActiveChatView } = useChatViewContext();
  useEffect(() => {
    setActiveChatView("threads");
  }, [setActiveChatView]);
  return null;
}

/**
 * Top-level wrapper that gates rendering on Chat being connected — same
 * pattern as ChannelListSection. <ThreadList> / <ChatView> need a connected
 * client.
 */
export function ThreadsPageClient() {
  const { client } = useChatContext();
  if (!client) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
        Connecting to chat…
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b bg-background px-4 py-3">
        <h1 className="text-sm font-semibold">Threads</h1>
        <p className="text-xs text-muted-foreground">
          Conversations you're part of
        </p>
      </header>
      <div className="flex-1 min-h-0">
        <ThreadsView />
      </div>
    </div>
  );
}
