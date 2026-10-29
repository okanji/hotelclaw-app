"use client";

import { createContext, createElement, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export type AssigneeInfo = { name: string; avatar?: string };

/**
 * Batched lookup of assignee profiles for the tasks board. We pass every
 * assignee id on the board in one call so list/board/timeline views all share
 * a single hit per render — RQ then dedupes identical id lists across hooks
 * via the stable `["assignees", sortedIds.join(",")]` key.
 *
 * RLS on `profiles` only returns users who share a property with the caller,
 * so it's safe to send the raw assignee ids straight to the lookup endpoint.
 */
export function useAssigneesMap(ids: (string | null | undefined)[]) {
  // Sort + dedupe so two equivalent input lists hit the same query key.
  const uniqueSorted = useMemo(() => {
    const set = new Set<string>();
    for (const id of ids) if (id) set.add(id);
    return [...set].sort();
  }, [ids]);

  const enabled = uniqueSorted.length > 0;
  const key = uniqueSorted.join(",");

  const { data } = useQuery({
    queryKey: ["assignees", key],
    queryFn: async () => {
      const params = new URLSearchParams();
      uniqueSorted.forEach((id) => params.append("ids", id));
      const res = await fetch(`/api/users/lookup?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return {} as Record<string, AssigneeInfo>;
      return (await res.json()) as Record<string, AssigneeInfo>;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  return data ?? EMPTY;
}

const EMPTY: Record<string, AssigneeInfo> = {};

/**
 * The board's resolved assignee map, shared down the tree so a card can draw
 * EVERY assignee (0115) without each call site threading a second prop. The
 * board already looks up all ids at once; this just exposes that result.
 */
const AssigneesMapContext = createContext<Record<string, AssigneeInfo>>(EMPTY);

export function AssigneesMapProvider({
  value,
  children,
}: {
  value: Record<string, AssigneeInfo>;
  children: React.ReactNode;
}) {
  return createElement(AssigneesMapContext.Provider, { value }, children);
}

export function useAssigneesMapContext(): Record<string, AssigneeInfo> {
  return useContext(AssigneesMapContext);
}
