"use client";

import type { ResolveUsersArgs } from "@liveblocks/client";

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
