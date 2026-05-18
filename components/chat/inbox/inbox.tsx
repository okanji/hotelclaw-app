"use client";

import { useQuery } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import type { MessageResponse, SearchAPIResponse } from "stream-chat";
import { Inbox as InboxIcon } from "lucide-react";
import { MentionRow } from "./mention-row";
import { useMarkMentionsSeenOnMount } from "./use-unread-mentions";
import { InboxSkeleton } from "./inbox-skeleton";
import { PageHeader } from "@/components/shell/page-header";

type Hit = SearchAPIResponse["results"][number];

/**
 * Slack-style "Mentions" inbox: every message across the property where the
 * current user was @-mentioned, newest first. Driven by Stream's search
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
  const { client } = useChatContext();

  // Visiting the inbox = "I've seen these". Clears the sidebar badge.
  useMarkMentionsSeenOnMount(userId);

  const { data: hits, isPending, error } = useQuery<Hit[]>({
    queryKey: ["mentions", propertyId, userId],
    // The search runs over the Stream client; only fetch once it's connected.
    // Hydrated data still displays before then.
    enabled: !!client?.user,
    queryFn: async () => {
      const res = await client!.search(
        {
          type: { $in: ["team", "messaging"] },
          property_id: propertyId,
          members: { $in: [client!.user!.id] },
        } as Parameters<typeof client.search>[0],
        { "mentioned_users.id": { $contains: client!.user!.id } },
        { limit: 50, sort: [{ created_at: -1 }] },
      );
      return res.results ?? [];
    },
  });

  if (isPending) return <InboxSkeleton />;

  const rows = hits ?? [];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title="Mentions"
        icon={<InboxIcon />}
        actions={
          <p className="text-xs text-muted-foreground">
            Every place you were @-mentioned in this property
          </p>
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        {error ? (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Search failed"}
          </p>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <InboxIcon className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No mentions yet</p>
            <p className="text-xs text-muted-foreground">
              When someone @-mentions you, it'll show up here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map(({ message }) => (
              <MentionRow
                key={message.id}
                propertyId={propertyId}
                message={message as MessageResponse}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
