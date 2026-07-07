"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import type {
  MessageFilters,
  MessageResponse,
  SearchAPIResponse,
  StreamChat,
} from "stream-chat";
import type { SearchState } from "./parse-search-params";

type SearchArg0 = Parameters<StreamChat["search"]>[0];

export type MessageHit = {
  message: MessageResponse;
  channelId: string | undefined;
};

export type MessageSearchPage = {
  hits: MessageHit[];
  next: string | undefined;
};

type Params = {
  propertyId: string;
  state: SearchState;
  /** Disable the query while inputs are still being typed. */
  enabled?: boolean;
};

const PAGE_SIZE = 25;

export function useMessageSearch({ propertyId, state, enabled = true }: Params) {
  const { client } = useChatContext();
  const me = client?.user?.id;

  const ready =
    enabled && !!client && !!me && state.q.trim().length >= 2;

  return useInfiniteQuery<MessageSearchPage, Error>({
    queryKey: ["message-search", propertyId, me, state],
    enabled: ready,
    initialPageParam: undefined,
    queryFn: async ({ pageParam }): Promise<MessageSearchPage> => {
      if (!client || !me) return { hits: [], next: undefined };

      const channelFilter = {
        property_id: propertyId,
        members: { $in: [me] },
        ...(state.in
          ? { id: state.in }
          : { type: { $in: ["team", "messaging"] } }),
      } as unknown as SearchArg0;

      const messageFilter: MessageFilters = {};
      if (state.from) {
        (messageFilter as Record<string, unknown>)["user.id"] = state.from;
      }
      if (state.after || state.before) {
        const range: Record<string, string> = {};
        if (state.after) range.$gte = state.after;
        if (state.before) range.$lt = state.before;
        (messageFilter as Record<string, unknown>).created_at = range;
      }
      if (state.has === "files") {
        (messageFilter as Record<string, unknown>).attachments = {
          $exists: true,
        };
      } else if (state.has === "links") {
        (messageFilter as Record<string, unknown>)["attachments.type"] = "link";
      }

      const hasMessageFilter = Object.keys(messageFilter).length > 0;
      // Stream's search takes either a plain query string OR a MessageFilters
      // object with `text` set. Use the object form whenever we need to combine
      // the query with from:/before:/after:/has: filters.
      const query: string | MessageFilters = hasMessageFilter
        ? ({ ...messageFilter, text: state.q.trim() } as MessageFilters)
        : state.q.trim();

      const res: SearchAPIResponse = await client.search(channelFilter, query, {
        limit: PAGE_SIZE,
        sort: [{ created_at: state.sort === "oldest" ? 1 : -1 }],
        ...(typeof pageParam === "string" ? { next: pageParam } : {}),
      });

      const hits: MessageHit[] = (res.results ?? []).map((r) => ({
        message: r.message,
        channelId: r.message.cid?.split(":")[1],
      }));
      return { hits, next: res.next };
    },
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });
}
