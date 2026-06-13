"use client";

import type { ComponentType } from "react";
import type { InsightsMetrics } from "@/lib/insights/metrics";
import type { InsightScope } from "@/lib/insights/scope";
import {
  AllReportsLink,
  IntelligenceBody,
  IntelligenceUpdated,
  WeeklyReportBody,
} from "./intelligence-strip";
import { AttentionList, FlowBody, OpenWorkBody } from "./pulse-view";
import { PortfolioBody } from "./portfolio-view";
import { WorkloadBody } from "./workload-view";
import {
  MeetingsBody,
  OpsActivityBody,
  StaleSopsBody,
  TeamBody,
  WorkflowRunsBody,
} from "./operations-view";
import { PinnedPromptsBody } from "./pinned-prompts";

export type InsightSectionProps = {
  propertyId: string;
  metrics: InsightsMetrics;
  scope: InsightScope;
};

export type InsightSectionDef = {
  id: string;
  /** Uppercase eyebrow above the title, editorial style. */
  kicker: string;
  /** Section heading. */
  title: string;
  /** Span both columns on wide containers. Default: one. */
  wide?: boolean;
  /** Only rendered on the property lens — not project / team / person. */
  propertyOnly?: boolean;
  /** Only rendered for owners. */
  ownerOnly?: boolean;
  Component: ComponentType<InsightSectionProps>;
  /** Optional extra header content (timestamps, links). */
  HeaderRight?: ComponentType<InsightSectionProps>;
};

function AttentionBody({ propertyId, metrics }: InsightSectionProps) {
  return <AttentionList propertyId={propertyId} items={metrics.attention} />;
}

/**
 * The Insights section catalog — the shipped default order. Mirrors the Home
 * dashboard registry: a user's saved arrangement (order + hidden) reconciles
 * against this list via `useDashboardLayout` (namespaced "insights-layout"),
 * and each entry renders as a drag-reorderable `EditorialSection` in the
 * insights grid. Sections gated by lens or role (`propertyOnly`, `ownerOnly`)
 * keep their saved position while filtered out, so re-lensing never scrambles
 * an arrangement.
 */
export const INSIGHT_SECTIONS: InsightSectionDef[] = [
  {
    id: "intelligence",
    kicker: "Analyst's read",
    title: "Intelligence",
    wide: true,
    Component: IntelligenceBody,
    HeaderRight: IntelligenceUpdated,
  },
  {
    id: "flow",
    kicker: "Momentum",
    title: "Flow",
    wide: true,
    Component: FlowBody,
  },
  {
    id: "pinned-prompts",
    kicker: "Standing questions",
    title: "Pinned questions",
    wide: true,
    Component: PinnedPromptsBody,
  },
  {
    id: "attention",
    kicker: "Needs a decision",
    title: "Attention",
    Component: AttentionBody,
  },
  {
    id: "open-work",
    kicker: "In flight",
    title: "Open work",
    Component: OpenWorkBody,
  },
  {
    id: "portfolio",
    kicker: "Initiatives",
    title: "Portfolio",
    wide: true,
    Component: PortfolioBody,
  },
  {
    id: "workload",
    kicker: "Capacity",
    title: "Load by person",
    wide: true,
    Component: WorkloadBody,
  },
  {
    id: "meetings",
    kicker: "Last 7 days",
    title: "Meetings & decisions",
    propertyOnly: true,
    Component: MeetingsBody,
  },
  {
    id: "stale-sops",
    kicker: "Knowledge",
    title: "Stale SOPs",
    propertyOnly: true,
    Component: StaleSopsBody,
  },
  {
    id: "workflow-runs",
    kicker: "Automation",
    title: "Workflow runs",
    wide: true,
    propertyOnly: true,
    Component: WorkflowRunsBody,
  },
  {
    id: "ops-activity",
    kicker: "Heartbeat",
    title: "Activity",
    propertyOnly: true,
    Component: OpsActivityBody,
  },
  {
    id: "team",
    kicker: "Owner",
    title: "Team",
    propertyOnly: true,
    ownerOnly: true,
    Component: TeamBody,
  },
  {
    id: "weekly-report",
    kicker: "AI briefing",
    title: "Weekly report",
    wide: true,
    propertyOnly: true,
    Component: WeeklyReportBody,
    HeaderRight: AllReportsLink,
  },
];

export const INSIGHT_SECTION_IDS = INSIGHT_SECTIONS.map((s) => s.id);

export const INSIGHT_SECTIONS_BY_ID = new Map(
  INSIGHT_SECTIONS.map((s) => [s.id, s]),
);
