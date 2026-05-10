"use client";

import { useQuery } from "@tanstack/react-query";

type Member = {
  id: string;
  role: string;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * Reads the current user's membership role for the given property by
 * filtering the shared property-members query (cached across the DM dialog
 * and the info panel). Returns `null` until data loads or if the user
 * isn't a member.
 */
export function useMyRole(
  propertyId: string,
  myUserId: string | undefined,
): "owner" | "manager" | "staff" | null {
  const { data } = useQuery<Member[]>({
    queryKey: ["property-members", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/members`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    enabled: !!myUserId,
    staleTime: 60_000,
  });
  if (!data || !myUserId) return null;
  const m = data.find((x) => x.id === myUserId);
  if (!m) return null;
  if (m.role === "owner" || m.role === "manager" || m.role === "staff") {
    return m.role;
  }
  return null;
}
