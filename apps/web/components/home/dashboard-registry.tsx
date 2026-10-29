import type { ComponentType } from "react";
import {
  Activity,
  Bell,
  CalendarClock,
  CalendarDays,
  CircleAlert,
  Compass,
  FileText,
  FolderKanban,
  ListChecks,
  type LucideIcon,
  Pin,
  Sparkles,
  Star,
  Sunrise,
  Sun,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  DeadlinesPanel,
  MyTasksPanel,
  ProjectProgressPanel,
  RecentActivityPanel,
} from "@/components/gr8r/home-overview";
import { QuickAccessWidget } from "./quick-access";
import { YourDayWidget } from "./widgets/your-day-widget";
import { PropertyPulseWidget } from "./widgets/property-pulse-widget";
import { ActivityWidget } from "./widgets/activity-widget";
import { PinnedForYouWidget } from "./widgets/pinned-for-you-widget";
import { TeamWidget } from "./widgets/team-widget";
import { RecentDocsWidget } from "./widgets/recent-docs-widget";
import { WorkflowHealthWidget } from "./widgets/workflow-health-widget";
import { PinnedResourcesWidget } from "./widgets/pinned-resources-widget";
import { AttentionWidget } from "./widgets/attention-widget";
import { ShiftBriefWidget } from "./widgets/shift-brief-widget";
import { MorningCheckinWidget } from "./widgets/morning-checkin-widget";
import { IntelligenceBriefWidget } from "./widgets/intelligence-brief-widget";

export type WidgetProps = { propertyId: string; userId: string };

/** gr8r palette token for a section's pastel icon chip (`var(--g8-<tone>)`). */
export type WidgetTone =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "violet"
  | "rose"
  | "orange"
  | "teal"
  | "gray";

export type WidgetDef = {
  id: string;
  /** Sentence-case 12px caption beside the title. */
  kicker: string;
  /** Section heading. */
  title: string;
  /** Glyph in the section's pastel chip. */
  icon: LucideIcon;
  tone: WidgetTone;
  /** Span the whole grid (tables, the brief, the quick-access strip). */
  span?: "full";
  /** The body draws its own rows edge to edge — no panel padding. */
  flush?: boolean;
  /** A quiet "View all"-style link in the section head. */
  link?: { label: string; href: (base: string) => string };
  Component: ComponentType<WidgetProps>;
};

/**
 * The Home section catalog — EVERYTHING on Home below the headline numbers,
 * in the shipped default order. Every entry renders as a `DocumentSection`
 * (a gr8r panel with a pastel icon chip, the title, a faint kicker, and the
 * drag grip + hide control on hover) inside one sortable two-column grid;
 * `span: "full"` rows take both columns. A user's saved layout (order +
 * hidden) is reconciled against this list, so adding a widget here surfaces
 * it for everyone without wiping their arrangement (`useDashboardLayout`).
 *
 * `your-tasks` and `workspace-activity` keep their historical ids (saved
 * layouts and presets name them) but are now gr8r's My tasks list and
 * activity feed from `components/gr8r/home-overview.tsx`.
 */
export const DASHBOARD_WIDGETS: WidgetDef[] = [
  {
    id: "intelligence",
    kicker: "Where things stand",
    title: "The brief",
    icon: Sparkles,
    tone: "violet",
    span: "full",
    link: { label: "Insights", href: (b) => `${b}/home/insights` },
    Component: IntelligenceBriefWidget,
  },
  {
    id: "attention",
    kicker: "Needs a decision",
    title: "Attention",
    icon: CircleAlert,
    tone: "rose",
    Component: AttentionWidget,
  },
  {
    id: "your-tasks",
    kicker: "Assigned to you",
    title: "My tasks",
    icon: ListChecks,
    tone: "blue",
    span: "full",
    flush: true,
    link: { label: "My tasks", href: (b) => `${b}/my-tasks` },
    Component: MyTasksPanel,
  },
  {
    id: "deadlines",
    kicker: "Next seven days",
    title: "Upcoming deadlines",
    icon: CalendarClock,
    tone: "amber",
    link: { label: "Calendar", href: (b) => `${b}/calendar` },
    Component: DeadlinesPanel,
  },
  {
    id: "project-progress",
    kicker: "In flight",
    title: "Projects",
    icon: FolderKanban,
    tone: "teal",
    span: "full",
    flush: true,
    link: { label: "All projects", href: (b) => `${b}/projects` },
    Component: ProjectProgressPanel,
  },
  {
    id: "workspace-activity",
    kicker: "Who did what",
    title: "Recent activity",
    icon: Activity,
    tone: "green",
    link: { label: "View all", href: (b) => `${b}/activity?view=workspace` },
    Component: RecentActivityPanel,
  },
  {
    id: "quick-access",
    kicker: "Jump to a workspace",
    title: "Quick access",
    icon: Compass,
    tone: "blue",
    span: "full",
    Component: QuickAccessWidget,
  },
  {
    id: "morning-checkin",
    kicker: "Your daily ritual",
    title: "Morning check-in",
    icon: Sunrise,
    tone: "orange",
    Component: MorningCheckinWidget,
  },
  {
    id: "shift-brief",
    kicker: "Since your last shift",
    title: "Shift brief",
    icon: Sun,
    tone: "amber",
    span: "full",
    Component: ShiftBriefWidget,
  },
  {
    id: "property-pulse",
    kicker: "Momentum",
    title: "Property pulse",
    icon: TrendingUp,
    tone: "green",
    Component: PropertyPulseWidget,
  },
  {
    id: "activity",
    kicker: "For you",
    title: "Notifications",
    icon: Bell,
    tone: "blue",
    Component: ActivityWidget,
  },
  {
    id: "pinned-for-you",
    kicker: "Saved by you",
    title: "Pinned for you",
    icon: Star,
    tone: "amber",
    Component: PinnedForYouWidget,
  },
  {
    id: "your-day",
    kicker: "On your calendar",
    title: "Your day",
    icon: CalendarDays,
    tone: "teal",
    Component: YourDayWidget,
  },
  {
    id: "team",
    kicker: "On site",
    title: "The team",
    icon: Users,
    tone: "violet",
    Component: TeamWidget,
  },
  {
    id: "recent-docs",
    kicker: "In motion",
    title: "Recent documents",
    icon: FileText,
    tone: "violet",
    Component: RecentDocsWidget,
  },
  {
    id: "workflow-health",
    kicker: "Automations",
    title: "Workflow health",
    icon: Zap,
    tone: "orange",
    Component: WorkflowHealthWidget,
  },
  {
    id: "pinned",
    kicker: "Pinned by the team",
    title: "Resources",
    icon: Pin,
    tone: "rose",
    span: "full",
    Component: PinnedResourcesWidget,
  },
];

export const DASHBOARD_WIDGET_IDS = DASHBOARD_WIDGETS.map((w) => w.id);

export const WIDGETS_BY_ID = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));
