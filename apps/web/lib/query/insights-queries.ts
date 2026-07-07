import { queryOptions } from "@tanstack/react-query";
import type { InsightsMetricsResponse } from "@/app/api/properties/[propertyId]/insights/metrics/route";
import type { OperationsResponse } from "@/app/api/properties/[propertyId]/insights/operations/route";
import type {
  InsightBriefRow,
  InsightReportRow,
  ProjectAnnotation,
} from "@/lib/ai/bots/insights-bot";
import type { ShiftBriefRow } from "@/lib/ai/bots/shift-brief-bot";
import type { ScopeStrip } from "@/lib/insights/metrics";
import {
  PROPERTY_SCOPE,
  scopeKey,
  type InsightScope,
} from "@/lib/insights/scope";

/**
 * React Query option factories for the Insights section. Both key families
 * share the `["insights", propertyId]` prefix so `useInsightsRealtime` can
 * invalidate the whole section with one prefix match.
 */

export function insightsMetricsQueryOptions(
  propertyId: string,
  scope: InsightScope = PROPERTY_SCOPE,
) {
  const key = scopeKey(scope);
  return queryOptions({
    queryKey: ["insights", propertyId, "metrics", key] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<InsightsMetricsResponse> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/metrics?scope=${key}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load insights");
      return res.json();
    },
  });
}

export function insightReportsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["insights", propertyId, "reports"] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<InsightReportRow[]> => {
      const res = await fetch(`/api/properties/${propertyId}/insights/report`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load reports");
      const body = (await res.json()) as { reports: InsightReportRow[] };
      return body.reports;
    },
  });
}

/** The automatic intelligence brief — stale-while-revalidate server-side; a
 *  fresh brief lands via the insight_briefs realtime invalidation. */
export function insightsBriefQueryOptions(
  propertyId: string,
  scope: InsightScope = PROPERTY_SCOPE,
) {
  const key = scopeKey(scope);
  return queryOptions({
    queryKey: ["insights", propertyId, "brief", key] as const,
    staleTime: 60_000,
    // First generation runs in the route's after() — poll until the brief
    // lands (realtime usually beats the poll; this covers generation
    // failures and missed realtime events), then stop.
    refetchInterval: (query) => (query.state.data?.pending ? 6_000 : false),
    queryFn: async (): Promise<{
      brief: InsightBriefRow | null;
      pending: boolean;
    }> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/brief?scope=${key}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load brief");
      return res.json();
    },
  });
}

/** The caller's own "since your last shift" brief — stale-while-revalidate
 *  server-side; polls while the first generation runs, then stops. */
export function shiftBriefQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["insights", propertyId, "shift-brief"] as const,
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.pending ? 6_000 : false),
    queryFn: async (): Promise<{
      brief: ShiftBriefRow | null;
      pending: boolean;
    }> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/shift-brief`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load shift brief");
      return res.json();
    },
  });
}

export type InsightFollowRow = {
  id: string;
  scope: string;
  cadence: "daily" | "weekly";
};

export type InsightAlertRuleRow = {
  id: string;
  scope: string;
  metric:
    | "overdue_count"
    | "blocked_count"
    | "unassigned_urgent_count"
    | "project_at_risk";
  threshold: number | null;
  enabled: boolean;
  last_triggered_at: string | null;
};

/** The caller's lens follows (email digests) for this property. */
export function insightsFollowsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["insights", propertyId, "follows"] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<InsightFollowRow[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/follows`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load follows");
      const body = (await res.json()) as { follows: InsightFollowRow[] };
      return body.follows;
    },
  });
}

/** The caller's threshold alert rules for this property. */
export function insightsAlertRulesQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["insights", propertyId, "alert-rules"] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<InsightAlertRuleRow[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/alert-rules`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load alert rules");
      const body = (await res.json()) as { rules: InsightAlertRuleRow[] };
      return body.rules;
    },
  });
}

export type InsightPromptCard = {
  id: string;
  prompt: string;
  scope: string;
  answerMd: string | null;
  generatedAt: string | null;
};

/** The caller's pinned insight prompts — answers regenerate server-side
 *  (fingerprint-gated) on each visit; poll while any is unanswered. */
export function insightsPromptsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["insights", propertyId, "prompts"] as const,
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.pending ? 6_000 : false),
    queryFn: async (): Promise<{
      prompts: InsightPromptCard[];
      pending: boolean;
    }> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/prompts`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load pinned prompts");
      return res.json();
    },
  });
}

export function insightsOperationsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["insights", propertyId, "operations"] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<OperationsResponse> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/operations`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load operations");
      return res.json();
    },
  });
}

/** The ambient project/space header stat strip. */
export function insightsStripQueryOptions(
  propertyId: string,
  scope: { kind: "project" | "space"; id: string },
) {
  return queryOptions({
    queryKey: ["insights", propertyId, "strip", scope.kind, scope.id] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<ScopeStrip> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/strip?scope=${scope.kind}:${scope.id}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
  });
}

/** Haiku one-liners for flagged portfolio projects. POST but idempotent —
 *  unchanged rollups return cached notes without a model call. */
export function insightsAnnotationsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["insights", propertyId, "annotations"] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProjectAnnotation[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/annotations`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to load annotations");
      const body = (await res.json()) as { annotations: ProjectAnnotation[] };
      return body.annotations;
    },
  });
}
