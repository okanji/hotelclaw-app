import { createClient as createBrowserClient } from "@/lib/supabase/client";

/**
 * A workflow-event row flattened for the activity feed. `workflow_events` is
 * the durable log the workflow engine emits from DB triggers (see
 * `0026_workflows.sql` / `0040_workflow_task_scope_events.sql`): task created,
 * status changed, (re)assigned, labelled, moved between space/project. It
 * carries no acting-user id (triggers run below the app layer), so the feed
 * describes *what* happened and *when*, not *who*.
 */
export type ActivityEvent = {
  id: string;
  eventType: string;
  at: string;
  /** Task title, lifted from `payload.new.title`. */
  title: string | null;
  /** The `to` value (new status for status_changed). */
  toValue: string | null;
};

type Scope = { space: string } | { project: string };

type Row = {
  id: string;
  event_type: string;
  received_at: string;
  payload: {
    new?: { title?: string | null } | null;
    to?: string | null;
  } | null;
};

/**
 * Recent task activity scoped to a space or project. Reads the events whose
 * task currently sits in the given space (`payload.new.space_id`) or project
 * (`payload.new.project_id`), newest first.
 */
export function activityQuery(propertyId: string, scope: Scope) {
  const key = "space" in scope ? `space:${scope.space}` : `project:${scope.project}`;
  return {
    queryKey: ["activity", propertyId, key] as const,
    queryFn: async (): Promise<ActivityEvent[]> => {
      const supabase = createBrowserClient();
      let q = supabase
        .from("workflow_events")
        .select("id, event_type, received_at, payload")
        .eq("property_id", propertyId)
        .eq("source", "pg.tasks")
        .order("received_at", { ascending: false })
        .limit(12);
      q =
        "space" in scope
          ? q.eq("payload->new->>space_id", scope.space)
          : q.eq("payload->new->>project_id", scope.project);
      const { data } = await q;
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        eventType: r.event_type,
        at: r.received_at,
        title: r.payload?.new?.title ?? null,
        toValue: r.payload?.to ?? null,
      }));
    },
  };
}
