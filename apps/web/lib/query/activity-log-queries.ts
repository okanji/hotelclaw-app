import { queryOptions } from "@tanstack/react-query";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { ActivityActorKind, ActivityEntityKind } from "@/lib/db/types";

/**
 * One row of `activity_log` (migration 0106) — an actor-aware, human-meaningful
 * change to a task, project or milestone. Unlike `workflow_events` (the
 * automation outbox, no actor), this is what the Activity surfaces render:
 * "Sarah moved *Finalize navigation* to Review · 2h".
 */
export type ActivityLogRow = {
  id: string;
  property_id: string;
  actor_id: string | null;
  actor_kind: ActivityActorKind;
  entity_kind: ActivityEntityKind;
  entity_id: string;
  entity_title: string | null;
  verb: string;
  detail: Record<string, unknown>;
  project_id: string | null;
  space_id: string | null;
  created_at: string;
};

/** Which slice of the log to read. Every scope is still fenced by property. */
export type ActivityScope =
  | { kind: "property" }
  | { kind: "project"; id: string }
  | { kind: "space"; id: string }
  | { kind: "task"; id: string }
  | { kind: "actor"; id: string };

/**
 * Coarse verb families for the feed's filter chips. `matchesFamily` keeps the
 * mapping in one place so the chips and any badge counts never disagree.
 */
export type ActivityFamily =
  | "all"
  | "status"
  | "assignments"
  | "dates"
  | "created"
  | "projects";

export function matchesFamily(row: ActivityLogRow, family: ActivityFamily) {
  switch (family) {
    case "all":
      return true;
    case "status":
      return (
        row.entity_kind === "task" &&
        (row.verb === "status_changed" ||
          row.verb === "completed" ||
          row.verb === "reopened" ||
          row.verb === "priority_changed")
      );
    case "assignments":
      return row.verb === "assigned" || row.verb === "unassigned";
    case "dates":
      return (
        row.verb === "due_changed" ||
        row.verb === "scheduled" ||
        row.verb === "dates_changed" ||
        row.verb.startsWith("milestone_")
      );
    case "created":
      return row.verb === "created" || row.verb === "deleted";
    case "projects":
      return (
        row.entity_kind === "project" ||
        row.entity_kind === "milestone" ||
        row.verb === "project_changed" ||
        row.verb === "project_removed"
      );
  }
}

export function activityScopeKey(scope: ActivityScope): string {
  return scope.kind === "property" ? "property" : `${scope.kind}:${scope.id}`;
}

export function activityLogQueryOptions(
  propertyId: string,
  scope: ActivityScope,
  limit = 200,
) {
  return queryOptions({
    queryKey: ["activity-log", propertyId, activityScopeKey(scope), limit] as const,
    queryFn: async (): Promise<ActivityLogRow[]> => {
      const supabase = createBrowserClient();
      let q = supabase
        .from("activity_log")
        .select(
          "id, property_id, actor_id, actor_kind, entity_kind, entity_id, entity_title, verb, detail, project_id, space_id, created_at",
        )
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      switch (scope.kind) {
        case "project":
          q = q.eq("project_id", scope.id);
          break;
        case "space":
          q = q.eq("space_id", scope.id);
          break;
        case "task":
          q = q.eq("entity_id", scope.id);
          break;
        case "actor":
          q = q.eq("actor_id", scope.id);
          break;
        case "property":
          break;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as ActivityLogRow[];
    },
  });
}
