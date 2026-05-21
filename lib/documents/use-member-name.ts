"use client";

import { useQuery } from "@tanstack/react-query";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";

/** Resolve a property member's display name from the shared members cache. */
export function useMemberName(
  propertyId: string,
  userId: string | null | undefined,
): string | undefined {
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  if (!userId) return undefined;
  return members.find((m) => m.id === userId)?.name ?? undefined;
}
