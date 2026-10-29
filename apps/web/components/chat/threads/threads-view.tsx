"use client";

import { StreamReady } from "@/lib/stream/client-provider";
import { MessageSquareText } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { ThreadsFeed, ThreadsLoading } from "./threads-feed";

/**
 * Top-level wrapper for the /threads page (gr8r `.page` › `.ph`). The actual rendering is the
 * Slack-style stacked feed in `<ThreadsFeed>` — each thread card carries
 * its own channel + reply composer, full-width, scrollable as one column.
 * No ChatView / two-pane layout here: that pattern doesn't fit a feed of
 * unrelated threads from different channels.
 */
export function ThreadsPageClient() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title="Threads" icon={<MessageSquareText />} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 880 }}>
          <div className="ph">
            <div>
              <h1>Threads</h1>
              <p>Conversations you&apos;re part of, newest activity first.</p>
            </div>
          </div>
          {/* ThreadsFeed activates Stream's ThreadManager (a query) on mount —
              wait for a connected user. */}
          <StreamReady fallback={<ThreadsLoading />}>
            <ThreadsFeed />
          </StreamReady>
        </div>
      </div>
    </div>
  );
}
