"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectedStreamClient } from "@/lib/stream/client-provider";
import type { MessageResponse } from "stream-chat";
import { AtSign } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { MentionRow } from "./mention-row";
import { useMarkMentionsSeenOnMount } from "./use-unread-mentions";
import { InboxSkeleton } from "./inbox-skeleton";
import { mentionsQueryOptions } from "@/lib/query/section-queries";
import { PageHeader } from "@/components/shell/page-header";

/**
 * Slack-style "Mentions" inbox in gr8r's notifications idiom (`.page` ›
 * `.ph` › one `.panel` of `.nrow`s): every message across the property where
 * the current user was @-mentioned, newest first. Driven by Stream's search
 * endpoint with a `mentioned_users.id` filter.
 *
 * The search runs through React Query keyed by `["mentions", propertyId,
 * userId]` — the same key `inbox/page.tsx` prefetches server-side — so the
 * list renders populated on first paint and the cache survives navigation.
 * `userId` comes in as a prop (not from the Stream client) so the query key
 * matches the server prefetch even before the websocket has connected.
 */
export function InboxView({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const client = useConnectedStreamClient();

  // Visiting the inbox = "I've seen these". Clears the sidebar badge.
  useMarkMentionsSeenOnMount(userId);

  const { data: hits, isPending, error } = useQuery(
    mentionsQueryOptions(propertyId, userId, client),
  );

  if (isPending) return <InboxSkeleton />;

  const rows = hits ?? [];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title="Mentions" icon={<AtSign />} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 820 }}>
          <div className="ph">
            <div>
              <h1 className="row" style={{ gap: 10 }}>
                Mentions
                {rows.length ? (
                  <span className="badge gray">{rows.length}</span>
                ) : null}
              </h1>
              <p>Every place you were @-mentioned in this property.</p>
            </div>
          </div>
          {error ? (
            <div className="alert danger">
              {error instanceof Error ? error.message : "Search failed"}
            </div>
          ) : rows.length === 0 ? (
            <div className="panel">
              <div className="empty-state">
                <div className="glyph">
                  <Gi icon={AtSign} size={20} />
                </div>
                <h2 className="es-h">No mentions yet</h2>
                <p>When someone @-mentions you, it&apos;ll show up here.</p>
              </div>
            </div>
          ) : (
            <div className="panel" style={{ overflow: "hidden" }}>
              {rows.map(({ message }) => (
                <MentionRow
                  key={message.id}
                  propertyId={propertyId}
                  message={message as MessageResponse}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
