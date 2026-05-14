"use client";

import type {
  ResolveMentionSuggestionsArgs,
  ResolveUsersArgs,
} from "@liveblocks/client";
import { propertyIdFromRoomId } from "./rooms";

type UserInfo = {
  name: string;
  avatar?: string;
};

export async function resolveUsers({
  userIds,
}: ResolveUsersArgs): Promise<(UserInfo | undefined)[]> {
  if (userIds.length === 0) return [];
  const params = new URLSearchParams();
  userIds.forEach((id) => params.append("ids", id));
  try {
    const res = await fetch(`/api/users/lookup?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return userIds.map(() => undefined);
    const map = (await res.json()) as Record<string, UserInfo>;
    return userIds.map((id) => map[id]);
  } catch {
    return userIds.map(() => undefined);
  }
}

/**
 * Comment-composer mention search. Liveblocks calls this when the user types
 * `@` in a thread composer. The property is parsed out of the room id (we
 * use `property:<uuid>:...` everywhere — see lib/liveblocks/server.ts) so the
 * results stay scoped to the user's tenant.
 */
export async function resolveMentionSuggestions({
  text,
  roomId,
}: ResolveMentionSuggestionsArgs): Promise<string[]> {
  const propertyId = roomId ? propertyIdFromRoomId(roomId) : null;
  if (!propertyId) return [];
  const params = new URLSearchParams({ text, propertyId });
  try {
    const res = await fetch(`/api/users/search?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return (await res.json()) as string[];
  } catch {
    return [];
  }
}

