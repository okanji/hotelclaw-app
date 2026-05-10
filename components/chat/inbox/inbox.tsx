"use client";

import { useEffect, useState } from "react";
import { useChatContext } from "stream-chat-react";
import type { MessageResponse, SearchAPIResponse } from "stream-chat";
import { MentionRow } from "./mention-row";
import { Inbox as InboxIcon } from "lucide-react";

type Hit = SearchAPIResponse["results"][number];

/**
 * Slack-style "Mentions" inbox: every message across the property where the
 * current user was @-mentioned, newest first. Driven by Stream's search
 * endpoint with `mentioned_users.id` filter — no DB queries, no event fan-in,
 * just a single typed query.
 */
export function InboxView({ propertyId }: { propertyId: string }) {
  const { client } = useChatContext();
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client?.user) return;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await client!.search(
          {
            type: { $in: ["team", "messaging"] },
            property_id: propertyId,
            members: { $in: [client!.user!.id] },
          } as Parameters<typeof client.search>[0],
          {
            "mentioned_users.id": { $contains: client!.user!.id },
          },
          { limit: 50, sort: [{ created_at: -1 }] },
        );
        if (!cancelled) setHits(res.results ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Search failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [client, propertyId]);

  if (!client) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Connecting to chat…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <InboxIcon className="size-4" />
          <h1 className="text-sm font-semibold">Mentions</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Every place you were @-mentioned in this property
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : hits.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <InboxIcon className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No mentions yet</p>
            <p className="text-xs text-muted-foreground">
              When someone @-mentions you, it'll show up here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {hits.map(({ message }) => (
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
