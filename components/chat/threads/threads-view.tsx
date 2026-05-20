"use client";

import { useChatContext } from "stream-chat-react";
import { MessageSquareText } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { ThreadsFeed } from "./threads-feed";

/**
 * Top-level wrapper for the /threads page. The actual rendering is the
 * Slack-style stacked feed in `<ThreadsFeed>` — each thread card carries
 * its own channel + reply composer, full-width, scrollable as one column.
 * No ChatView / two-pane layout here: that pattern doesn't fit a feed of
 * unrelated threads from different channels.
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
      <PageHeader
        title="Threads"
        icon={<MessageSquareText />}
        actions={
          <p className="text-xs text-muted-foreground">
            Conversations you&apos;re part of
          </p>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ThreadsFeed />
      </div>
    </div>
  );
}
