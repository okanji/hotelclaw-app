"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useChannelStateContext, useChatContext } from "stream-chat-react";
import type {
  Attachment,
  MessageFilters,
  MessageResponse,
  SearchAPIResponse,
  StreamChat,
  UserResponse,
} from "stream-chat";

type SearchArg0 = Parameters<StreamChat["search"]>[0];

/**
 * Slack-style file categories. Stream's `attachments.type` filter supports
 * `$eq` and `$in`, so we can pull each category server-side without dragging
 * down full message bodies. See:
 * https://getstream.io/chat/docs/react/search/
 */
export type FilesMode = "media" | "docs";

/**
 * Stream attachment `type` strings that map to each tab. Voice notes ride
 * in the docs bucket so they don't clutter the photo grid.
 */
const MEDIA_TYPES = ["image", "video"] as const;
const DOC_TYPES = ["file", "audio", "voiceRecording"] as const;

/** Flat hit per attachment so the UI can render attachments, not messages. */
export type FileHit = {
  attachment: Attachment;
  message: MessageResponse;
  user: UserResponse | undefined;
};

export type FilesPage = {
  hits: FileHit[];
  next: string | undefined;
};

const PAGE_SIZE = 30;

/**
 * Server-side, cursor-paginated fetch of every attachment in the current
 * Stream channel that matches `mode`. Wraps `client.search()` with an
 * `attachments.type: { $in: [...] }` filter and uses the `next` token so we
 * never have to load all messages just to enumerate files.
 *
 * Returns the underlying `useInfiniteQuery` so callers get
 * `data.pages` + `fetchNextPage` for free (matches `use-message-search.ts`).
 */
export function useChannelFiles({
  mode,
  enabled = true,
}: {
  mode: FilesMode;
  enabled?: boolean;
}) {
  const { client } = useChatContext();
  const { channel } = useChannelStateContext();

  const cid = channel?.cid;
  const ready = enabled && !!client && !!cid;

  return useInfiniteQuery<FilesPage, Error>({
    queryKey: ["channel-files", cid, mode],
    enabled: ready,
    initialPageParam: undefined,
    queryFn: async ({ pageParam }): Promise<FilesPage> => {
      if (!client || !cid) return { hits: [], next: undefined };

      const channelFilter = { cid } as unknown as SearchArg0;

      const types = mode === "media" ? MEDIA_TYPES : DOC_TYPES;
      const messageFilter: MessageFilters = {
        // The API wants the dotted path as a key on the filter object.
        "attachments.type": { $in: [...types] },
      } as unknown as MessageFilters;

      const res: SearchAPIResponse = await client.search(
        channelFilter,
        messageFilter,
        {
          limit: PAGE_SIZE,
          sort: [{ created_at: -1 }],
          ...(typeof pageParam === "string" ? { next: pageParam } : {}),
        },
      );

      const hits: FileHit[] = [];
      for (const r of res.results ?? []) {
        const msg = r.message;
        for (const a of msg.attachments ?? []) {
          if (!a?.type) continue;
          if (!(types as readonly string[]).includes(a.type)) continue;
          hits.push({ attachment: a, message: msg, user: msg.user ?? undefined });
        }
      }

      return { hits, next: res.next };
    },
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });
}

/** Flatten paginated pages into a single ordered list for rendering. */
export function flattenFiles(
  pages: FilesPage[] | undefined,
): FileHit[] {
  if (!pages) return [];
  const out: FileHit[] = [];
  for (const p of pages) out.push(...p.hits);
  return out;
}
