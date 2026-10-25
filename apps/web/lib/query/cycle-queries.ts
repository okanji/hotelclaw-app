import { queryOptions } from "@tanstack/react-query";
import type { Database } from "@/lib/db/types";
import type { CyclePhase } from "@/lib/cycles/plan";

/** One `cycles` row (migration 0111) tagged with its phase for "today". */
export type CycleListItem = Database["public"]["Tables"]["cycles"]["Row"] & {
  phase: CyclePhase;
};
export type CycleSettings =
  Database["public"]["Tables"]["cycle_settings"]["Row"];

export type CyclesPayload = {
  /** Today in the property's calendar (YYYY-MM-DD). */
  today: string;
  timeZone: string;
  settings: CycleSettings[];
  /** Every cycle in the property, oldest first. */
  cycles: CycleListItem[];
};

/**
 * Every cadence + cycle in the property. The route materialises due cycles
 * and rolls ended ones over before answering, so reading this IS the lazy
 * "cron". Invalidate `["cycles", propertyId]` after a settings change or a
 * task's cycle moves.
 */
export function cyclesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["cycles", propertyId] as const,
    queryFn: async (): Promise<CyclesPayload> => {
      const res = await fetch(`/api/properties/${propertyId}/cycles`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load cycles");
      return res.json();
    },
    staleTime: 60_000,
  });
}

/** One cadence's slice — what the sidebar's "Cycles → Current / Upcoming" draws. */
export type CycleScopeSummary = {
  /** null = the property-wide cadence. */
  spaceId: string | null;
  current: CycleListItem | null;
  upcoming: CycleListItem[];
};

/**
 * Group the payload per enabled cadence (property-wide first, then teams in
 * settings order). Use as a `select` on `cyclesQueryOptions`.
 */
export function cycleScopes(data: CyclesPayload): CycleScopeSummary[] {
  return data.settings
    .filter((s) => s.enabled)
    .sort((a, b) => Number(a.space_id !== null) - Number(b.space_id !== null))
    .map((s) => {
      const mine = data.cycles.filter((c) => c.space_id === s.space_id);
      return {
        spaceId: s.space_id,
        current: mine.find((c) => c.phase === "current") ?? null,
        upcoming: mine.filter((c) => c.phase === "upcoming"),
      };
    });
}

/** `?space=` value for a cadence: a team id, or `property` for property-wide. */
export function cycleScopeParam(spaceId: string | null) {
  return spaceId ?? "property";
}

/** Href of a cadence's cycles list. */
export function cyclesHref(propertyId: string, spaceId: string | null) {
  return `/p/${propertyId}/cycles?space=${cycleScopeParam(spaceId)}`;
}
