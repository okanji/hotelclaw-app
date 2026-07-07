/**
 * Insight scopes — the lens the Insights page (and its AI brief) is computed
 * through. Shared by client (switcher, query keys) and server (metrics
 * filtering, brief caching), so it carries no server-only imports.
 *
 *   property — the whole workspace (default)
 *   project  — one initiative's slice
 *   space    — one team's slice (spaces are the app's teams)
 *   person   — one individual's slice (management only)
 */

export type InsightScope =
  | { kind: "property" }
  | { kind: "project"; id: string }
  | { kind: "space"; id: string }
  | { kind: "person"; id: string };

export const PROPERTY_SCOPE: InsightScope = { kind: "property" };

/** Stable cache/query key — also the wire format for `?scope=`. */
export function scopeKey(scope: InsightScope): string {
  return scope.kind === "property" ? "property" : `${scope.kind}:${scope.id}`;
}

const SCOPE_RE = /^(project|space|person):([0-9a-f-]{36})$/;

/** Parse the wire format; null on anything malformed. */
export function parseScope(raw: string | null | undefined): InsightScope | null {
  if (!raw || raw === "property") return PROPERTY_SCOPE;
  const m = raw.match(SCOPE_RE);
  if (!m) return null;
  return { kind: m[1] as "project" | "space" | "person", id: m[2] };
}
