import { DASHBOARD_WIDGET_IDS } from "./dashboard-registry";

/**
 * Home is role-adaptive ("Compass"): the SAME widget registry, but the
 * first-render default order and the one promoted "Today" hero are chosen from
 * the viewer's property role. Owners land on the analyst's brief, managers on
 * what needs a decision, staff on their shift. Nothing here changes data
 * permissions or what a user can do — only what they start with. When the role
 * is unknown the order falls back to the shipped registry order and no hero is
 * promoted, so Home degrades to its persona-blind default byte-for-byte.
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
 * The single widget promoted into the "Today" hero band per role. `intelligence`
 * is hero-only (it isn't a masonry tile — see dashboard-registry); the other two
 * are real registry widgets that get lifted out of the grid for their lens so
 * they aren't shown twice.
 */
export const HERO_BY_ROLE: Record<HomeRole, string> = {
  owner: "intelligence",
  manager: "attention",
  staff: "shift-brief",
};

export function heroFor(role: HomeLens): string | null {
  return role ? HERO_BY_ROLE[role] : null;
}

/**
 * Role-tuned base orders over the registry. Each lists every id in
 * `DASHBOARD_WIDGET_IDS` so reconciliation in `useDashboardLayout` never has to
 * append (and a newly-shipped widget still surfaces via that append path). The
 * order encodes the persona's priority: owners lead with guests + risk +
 * momentum, managers with throughput + their queue, staff with their own work.
 */
const BASE_ORDER: Record<HomeRole, string[]> = {
  owner: [
    "bookings-today",
    "attention",
    "property-pulse",
    "workflow-health",
    "your-tasks",
    "your-day",
    "shift-brief",
    "activity",
    "recent-docs",
    "team",
    "pinned-for-you",
    "pinned",
  ],
  manager: [
    "property-pulse",
    "workflow-health",
    "your-tasks",
    "your-day",
    "attention",
    "activity",
    "bookings-today",
    "shift-brief",
    "recent-docs",
    "team",
    "pinned-for-you",
    "pinned",
  ],
  staff: [
    "your-tasks",
    "your-day",
    "attention",
    "shift-brief",
    "activity",
    "team",
    "pinned-for-you",
    "recent-docs",
    "bookings-today",
    "workflow-health",
    "property-pulse",
    "pinned",
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
