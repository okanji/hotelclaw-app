"use client";

import type { ComponentType } from "react";
import type { InsightsMetrics } from "@/lib/insights/metrics";
import type { InsightScope } from "@/lib/insights/scope";
import { IntelligenceBody, IntelligenceUpdated } from "./intelligence-strip";
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

/** Which dashboard tab a section belongs to. Reports is a leaf view, not a
 *  grid of sortable sections, so no section maps to it. */
export type InsightTab = "overview" | "work" | "operations" | "reports";

export const INSIGHT_TABS: {
  id: InsightTab;
  label: string;
  /** Blurb shown under the masthead when this tab is active. */
  blurb: string;
  /** Only offered on the property lens (not project / team / person). */
  propertyOnly?: boolean;
}[] = [
  {
    id: "overview",
    label: "Overview",
    blurb: "The analyst's read, what needs a decision, and this week's momentum.",
  },
  {
    id: "work",
    label: "Work",
    blurb: "Every initiative, all open work, and how load sits across the team.",
  },
  {
    id: "operations",
    label: "Operations",
    blurb: "The machinery — meetings, automation, knowledge, and team.",
    propertyOnly: true,
  },
  {
    id: "reports",
    label: "Reports",
    blurb:
      "The AI analyst's weekly briefings — written from the same numbers Insights charts.",
    propertyOnly: true,
  },
];

export type InsightSectionDef = {
  id: string;
  /** Which dashboard tab hosts this section. */
  tab: Exclude<InsightTab, "reports">;
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
  // ── Overview — the read, the decisions, the momentum ──────────────────────
  {
    id: "intelligence",
    tab: "overview",
    kicker: "Analyst's read",
    title: "Intelligence",
    wide: true,
    Component: IntelligenceBody,
    HeaderRight: IntelligenceUpdated,
  },
  {
    id: "attention",
    tab: "overview",
    kicker: "Needs a decision",
    title: "Attention",
    Component: AttentionBody,
  },
  {
    id: "flow",
    tab: "overview",
    kicker: "Momentum",
    title: "Flow",
    wide: true,
    Component: FlowBody,
  },
  {
    id: "pinned-prompts",
    tab: "overview",
    kicker: "Standing questions",
    title: "Pinned questions",
    wide: true,
    Component: PinnedPromptsBody,
  },
  // ── Work — initiatives, open work, capacity ───────────────────────────────
  {
    id: "portfolio",
    tab: "work",
    kicker: "Initiatives",
    title: "Portfolio",
    wide: true,
    Component: PortfolioBody,
  },
  {
    id: "open-work",
    tab: "work",
    kicker: "In flight",
    title: "Open work",
    Component: OpenWorkBody,
  },
  {
    id: "workload",
    tab: "work",
    kicker: "Capacity",
    title: "Load by person",
    wide: true,
    Component: WorkloadBody,
  },
  // ── Operations — the property's machinery (property lens only) ────────────
  {
    id: "meetings",
    tab: "operations",
    kicker: "Last 7 days",
    title: "Meetings & decisions",
    propertyOnly: true,
    Component: MeetingsBody,
  },
  {
    id: "stale-sops",
    tab: "operations",
    kicker: "Knowledge",
    title: "Stale SOPs",
    propertyOnly: true,
    Component: StaleSopsBody,
  },
  {
    id: "workflow-runs",
    tab: "operations",
    kicker: "Automation",
    title: "Workflow runs",
    wide: true,
    propertyOnly: true,
    Component: WorkflowRunsBody,
  },
  {
    id: "ops-activity",
    tab: "operations",
    kicker: "Heartbeat",
    title: "Activity",
    propertyOnly: true,
    Component: OpsActivityBody,
  },
  {
    id: "team",
    tab: "operations",
    kicker: "Owner",
    title: "Team",
    propertyOnly: true,
    ownerOnly: true,
    Component: TeamBody,
  },
];

export const INSIGHT_SECTION_IDS = INSIGHT_SECTIONS.map((s) => s.id);

export const INSIGHT_SECTIONS_BY_ID = new Map(
  INSIGHT_SECTIONS.map((s) => [s.id, s]),
);
