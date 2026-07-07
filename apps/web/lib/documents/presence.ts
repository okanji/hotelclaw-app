import type { DocumentPresenceUser } from "@/lib/query/section-queries";

/** Liveblocks can return the same user twice when they have multiple tabs open. */
export function uniquePresenceUsers(
  users: DocumentPresenceUser[],
): DocumentPresenceUser[] {
  const seen = new Set<string>();
  const unique: DocumentPresenceUser[] = [];
  for (const user of users) {
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    unique.push(user);
  }
  return unique;
}
