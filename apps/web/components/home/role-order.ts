import { DASHBOARD_WIDGET_IDS } from "./dashboard-registry";

/**
 * Home is role-adaptive ("Compass"): the SAME section registry, but the
 * first-render default order is chosen from the viewer's property role.
 * Owners lead with the analyst's brief, managers with what needs a decision,
 * staff with their shift. Nothing here changes data permissions or what a
 * user can do — only what they start with. When the role is unknown the
 * order falls back to the shipped registry order, so Home degrades to its
 * persona-blind default byte-for-byte.
 */

export type HomeRole = "owner" | "manager" | "staff";
export type HomeLens = HomeRole | null;

/** Coerce a raw membership role string into a known lens, or null. */
export function asHomeRole(role: string | null | undefined): HomeRole | null {
  return role === "owner" || role === "manager" || role === "staff"
    ? role
    : null;
}

/**
 * Role-tuned base orders over the registry. Each lists every id in
 * `DASHBOARD_WIDGET_IDS` so reconciliation in `useDashboardLayout` never has to
 * append (and a newly-shipped widget still surfaces via that append path). The
 * order encodes the persona's priority: owners lead with the brief + risk +
 * momentum, managers with their queue + throughput, staff with their own work.
 * The first full-width section IS the lens's "today" read.
 */
const BASE_ORDER: Record<HomeRole, string[]> = {
  owner: [
    "intelligence",
    "attention",
    "property-pulse",
    "your-tasks",
    "project-progress",
    "deadlines",
    "workspace-activity",
    "quick-access",
    "morning-checkin",
    "workflow-health",
    "your-day",
    "shift-brief",
    "activity",
    "recent-docs",
    "team",
    "pinned-for-you",
    "pinned",
  ],
  manager: [
    "attention",
    "deadlines",
    "your-tasks",
    "project-progress",
    "property-pulse",
    "workspace-activity",
    "quick-access",
    "morning-checkin",
    "workflow-health",
    "your-day",
    "intelligence",
    "activity",
    "shift-brief",
    "recent-docs",
    "team",
    "pinned-for-you",
    "pinned",
  ],
  staff: [
    "shift-brief",
    "your-day",
    "your-tasks",
    "deadlines",
    "attention",
    "quick-access",
    "morning-checkin",
    "activity",
    "workspace-activity",
    "team",
    "project-progress",
    "pinned-for-you",
    "recent-docs",
    "workflow-health",
    "property-pulse",
    "pinned",
    "intelligence",
  ],
};

/**
 * The first-render default order for a lens: the role's base order, reconciled
 * against the live registry so any id present in the registry but missing from
 * the base list is appended (and unknown ids dropped). Null role → the shipped
 * registry order unchanged.
 */
export function roleWeightedOrder(role: HomeLens): string[] {
  if (!role) return DASHBOARD_WIDGET_IDS;
  const known = new Set(DASHBOARD_WIDGET_IDS);
  const order = BASE_ORDER[role].filter((id) => known.has(id));
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

/**
 * Named dashboard presets (C4) — per-persona starting layouts the PO asked
 * for ("a template for the maintenance manager dashboard, front office
 * dashboard…"). Applying one overwrites the user's saved arrangement (they
 * can keep customizing after; Reset returns to their role default).
 */
export type DashboardPreset = {
  id: string;
  label: string;
  order: string[];
  hidden: string[];
};

export const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: "ops-manager",
    label: "Ops / maintenance manager",
    order: [
      "attention",
      "your-tasks",
      "deadlines",
      "project-progress",
      "workflow-health",
      "property-pulse",
      "workspace-activity",
      "morning-checkin",
      "shift-brief",
      "team",
      "quick-access",
    ],
    hidden: ["intelligence", "recent-docs", "pinned", "pinned-for-you", "activity"],
  },
  {
    id: "front-office",
    label: "Front office",
    order: [
      "your-day",
      "your-tasks",
      "deadlines",
      "shift-brief",
      "attention",
      "morning-checkin",
      "activity",
      "workspace-activity",
      "quick-access",
    ],
    hidden: ["intelligence", "workflow-health", "recent-docs", "project-progress", "property-pulse"],
  },
  {
    id: "owner-overview",
    label: "Owner's overview",
    order: [
      "intelligence",
      "attention",
      "property-pulse",
      "project-progress",
      "workflow-health",
      "team",
      "workspace-activity",
      "deadlines",
      "shift-brief",
    ],
    hidden: ["your-day", "pinned-for-you", "morning-checkin", "activity", "quick-access"],
  },
  {
    id: "my-shift",
    label: "My shift only",
    order: ["shift-brief", "your-tasks", "deadlines", "your-day", "morning-checkin"],
    hidden: [
      "intelligence",
      "property-pulse",
      "workflow-health",
      "attention",
      "activity",
      "workspace-activity",
      "project-progress",
      "quick-access",
      "recent-docs",
      "team",
      "pinned",
      "pinned-for-you",
    ],
  },
];
