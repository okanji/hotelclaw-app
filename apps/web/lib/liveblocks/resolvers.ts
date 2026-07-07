"use client";

import type {
  ResolveMentionSuggestionsArgs,
  ResolveUsersArgs,
} from "@liveblocks/client";
import { BOT_DISPLAY_NAME, BOT_USER_ID } from "@/lib/ai/bot-identity";
import { propertyIdFromRoomId } from "./rooms";

type UserInfo = {
  name: string;
  avatar?: string;
};

const BOT_INFO: UserInfo = { name: BOT_DISPLAY_NAME };

export async function resolveUsers({
  userIds,
}: ResolveUsersArgs): Promise<(UserInfo | undefined)[]> {
  if (userIds.length === 0) return [];
  // The bot user id isn't in the `profiles` table — short-circuit so its
  // display name + avatar render correctly in comment threads.
  const realIds = userIds.filter((id) => id !== BOT_USER_ID);
  if (realIds.length === 0) {
    return userIds.map((id) => (id === BOT_USER_ID ? BOT_INFO : undefined));
  }
  const params = new URLSearchParams();
  realIds.forEach((id) => params.append("ids", id));
  try {
    const res = await fetch(`/api/users/lookup?${params.toString()}`, {
      cache: "no-store",
    });
    const map = res.ok
      ? ((await res.json()) as Record<string, UserInfo>)
      : ({} as Record<string, UserInfo>);
    return userIds.map((id) => (id === BOT_USER_ID ? BOT_INFO : map[id]));
  } catch {
    return userIds.map((id) =>
      id === BOT_USER_ID ? BOT_INFO : undefined,
    );
  }
}

/**
 * Comment-composer mention search. Liveblocks calls this when the user types
 * `@` in a thread composer. The property is parsed out of the room id (we
 * use `property:<uuid>:...` everywhere — see lib/liveblocks/server.ts) so the
 * results stay scoped to the user's tenant.
 *
 * The Hotelclaw AI bot is injected at the top of the list (when it matches
 * the query) so users can `@hotelclaw-ai` in any comment thread to trigger
 * a reply via `app/api/liveblocks/webhook/route.ts` → `lib/ai/bot-scaffold.ts`.
 */
export async function resolveMentionSuggestions({
  text,
  roomId,
}: ResolveMentionSuggestionsArgs): Promise<string[]> {
  const propertyId = roomId ? propertyIdFromRoomId(roomId) : null;
  if (!propertyId) return [];
  const params = new URLSearchParams({ text, propertyId });
  let users: string[] = [];
  try {
    const res = await fetch(`/api/users/search?${params.toString()}`, {
      cache: "no-store",
    });
    if (res.ok) users = (await res.json()) as string[];
  } catch {
    users = [];
  }
  const q = text.trim().toLowerCase();
  const botMatches =
    q.length === 0 ||
    BOT_USER_ID.includes(q) ||
    BOT_DISPLAY_NAME.toLowerCase().includes(q);
  return botMatches ? [BOT_USER_ID, ...users] : users;
}

