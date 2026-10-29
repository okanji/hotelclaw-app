import type { Role } from "@/lib/db/types";

/**
 * The one place the membership role ladder is spelled out.
 *
 * `guest` (ClickUp-style external collaborator — contractors, event crews,
 * wedding planners) arrives with migration 0118: a guest HAS a membership
 * row, so property entry and `has_property_access()` work, but RLS only
 * shows them the spaces / lists / tasks / documents / channels they were
 * explicitly granted. Everything that is not a shared work surface
 * (insights, workflows, agents, chatbots, forms admin, invites,
 * settings) is for FULL members only — `is_member()` in Postgres means
 * exactly `FULL_ROLES` from 0118 on, so a new table that copies the usual
 * `is_member(property_id)` policy denies guests by default.
 *
 * Until 0118 lands the DB CHECK still rejects 'guest'; the TS union is
 * widened early so the helpers below can be wired in ahead of time.
 */
export const ROLES = ["owner", "manager", "staff", "guest"] as const satisfies readonly Role[];

/** Roles that see the whole property. Invitable today; guest joins in 0118. */
export const FULL_ROLES = ["owner", "manager", "staff"] as const satisfies readonly Role[];

/** Roles allowed to manage members, invites, org chart, status sets, guest grants. */
export const MANAGEMENT_ROLES = ["owner", "manager"] as const satisfies readonly Role[];

/** Display / sort order (members + invites dialogs). */
export const ROLE_ORDER: Role[] = ["owner", "manager", "staff", "guest"];

export type FullRole = (typeof FULL_ROLES)[number];

export function isFullMember(role: Role | null | undefined): role is FullRole {
  return role === "owner" || role === "manager" || role === "staff";
}

export function canManage(role: Role | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

export function isGuest(role: Role | null | undefined): boolean {
  return role === "guest";
}
