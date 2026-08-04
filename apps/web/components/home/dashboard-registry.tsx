import type { ComponentType } from "react";
import { YourTasksWidget } from "./widgets/your-tasks-widget";
import { YourDayWidget } from "./widgets/your-day-widget";
import { PropertyPulseWidget } from "./widgets/property-pulse-widget";
import { ActivityWidget } from "./widgets/activity-widget";
import { PinnedForYouWidget } from "./widgets/pinned-for-you-widget";
import { TeamWidget } from "./widgets/team-widget";
import { RecentDocsWidget } from "./widgets/recent-docs-widget";
import { WorkflowHealthWidget } from "./widgets/workflow-health-widget";
import { BookingsWidget } from "./widgets/bookings-widget";
import { PinnedResourcesWidget } from "./widgets/pinned-resources-widget";
import { AttentionWidget } from "./widgets/attention-widget";
import { ShiftBriefWidget } from "./widgets/shift-brief-widget";
import { MorningCheckinWidget } from "./widgets/morning-checkin-widget";

export type WidgetProps = { propertyId: string; userId: string };

export type WidgetDef = {
  id: string;
  /** Sentence-case 12px label above the title. */
  kicker: string;
  /** Section heading. */
  title: string;
  /** Span both columns on wide screens (boards / wide content). Default: one. */
  wide?: boolean;
  Component: ComponentType<WidgetProps>;
};

/**
 * The Home dashboard widget catalog — the shipped default order. A user's saved
 * layout (order + hidden) is reconciled against this list, so adding a widget
 * here surfaces it for everyone without wiping their arrangement
 * (`useDashboardLayout`). Each widget renders as an editorial section (kicker +
 * heading + divider content), not a card. On wide containers the sections flow
 * into two columns; `wide` widgets span both. Default order pairs Your tasks
 * with Property pulse.
 */
export const DASHBOARD_WIDGETS: WidgetDef[] = [
  {
    id: "morning-checkin",
    kicker: "Your daily ritual",
    title: "Morning check-in",
    wide: true,
    Component: MorningCheckinWidget,
  },
  {
    id: "shift-brief",
    kicker: "Since your last shift",
    title: "Shift brief",
    wide: true,
    Component: ShiftBriefWidget,
  },
  {
    id: "your-tasks",
    kicker: "Assigned to you",
    title: "Your tasks",
    Component: YourTasksWidget,
  },
  {
    id: "property-pulse",
    kicker: "Momentum",
    title: "Property pulse",
    Component: PropertyPulseWidget,
  },
  {
    id: "attention",
    kicker: "Needs a decision",
    title: "Attention",
    Component: AttentionWidget,
  },
  {
    id: "activity",
    kicker: "For you",
    title: "Recent activity",
    Component: ActivityWidget,
  },
  {
    id: "pinned-for-you",
    kicker: "Saved by you",
    title: "Pinned for you",
    Component: PinnedForYouWidget,
  },
  {
    id: "your-day",
    kicker: "On your calendar",
    title: "Your day",
    Component: YourDayWidget,
  },
  {
    id: "team",
    kicker: "On site",
    title: "The team",
    Component: TeamWidget,
  },
  {
    id: "recent-docs",
    kicker: "In motion",
    title: "Recent documents",
    Component: RecentDocsWidget,
  },
  {
    id: "workflow-health",
    kicker: "Automations",
    title: "Workflow health",
    Component: WorkflowHealthWidget,
  },
  {
    id: "bookings-today",
    kicker: "Guests",
    title: "Today's bookings",
    Component: BookingsWidget,
  },
  {
    id: "pinned",
    kicker: "Pinned by the team",
    title: "Resources",
    wide: true,
    Component: PinnedResourcesWidget,
  },
];

export const DASHBOARD_WIDGET_IDS = DASHBOARD_WIDGETS.map((w) => w.id);

export const WIDGETS_BY_ID = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));
