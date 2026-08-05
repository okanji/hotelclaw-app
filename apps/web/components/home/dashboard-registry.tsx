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
  Component: ComponentType<WidgetProps>;
};

/**
 * The Home widget catalog — the shipped default order. A user's saved layout
 * (order + hidden) is reconciled against this list, so adding a widget here
 * surfaces it for everyone without wiping their arrangement
 * (`useDashboardLayout`).
 *
 * Home is a **document**, not a dashboard: every entry renders as a
 * `DocumentSection` — a 24px heading, the `kicker` as a 12px faint caption
 * under it, then list-row content — stacked single-file down the 720px
 * `max-w-content` column. There is no two-column masonry any more, so there is
 * no `wide` flag: nothing on Home is a tabular data view that earns breaking
 * out of the column (the widest thing, the pinned-boards row, scrolls
 * horizontally inside it by design).
 */
export const DASHBOARD_WIDGETS: WidgetDef[] = [
  {
    id: "morning-checkin",
    kicker: "Your daily ritual",
    title: "Morning check-in",
    Component: MorningCheckinWidget,
  },
  {
    id: "shift-brief",
    kicker: "Since your last shift",
    title: "Shift brief",
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
    Component: PinnedResourcesWidget,
  },
];

export const DASHBOARD_WIDGET_IDS = DASHBOARD_WIDGETS.map((w) => w.id);

export const WIDGETS_BY_ID = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));
