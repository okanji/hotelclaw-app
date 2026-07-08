import { queryOptions } from "@tanstack/react-query";
import type { OrgChart } from "@/lib/org/queries";

/** The API augments the structural chart with live per-team open-task load. */
export type OrgChartResponse = OrgChart & {
  openTaskCounts: Record<string, number>;
};

export function orgChartQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["org-chart", propertyId] as const,
    queryFn: async (): Promise<OrgChartResponse> => {
      const res = await fetch(`/api/properties/${propertyId}/org`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load org chart");
      return res.json();
    },
  });
}
