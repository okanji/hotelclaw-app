import "server-only";
/**
 * Catch-up gather — what changed in one project/space since the caller's
 * cursor, collected deterministically from the event log. The UI renders
 * the counts and named highlights directly; the model only writes the
 * orientation sentence on top.
 */
import { createServiceClient } from "@/lib/supabase/server";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A user away for a month catches up on a week, not 30 days of noise. */
const MAX_WINDOW_MS = 7 * DAY_MS;

export type CatchUpSubjectKind = "project" | "space";

export type CatchUpPayload = {
  since: string;
  created: number;
  completed: number;
  blocked: number;
  assignedToMe: number;
  /** Up to 10 named movements, newest first. */
  highlights: { taskId: string; title: string; what: string; at: string }[];
};

export function isEmptyCatchUp(p: CatchUpPayload): boolean {
  return p.created === 0 && p.completed === 0 && p.blocked === 0 && p.highlights.length === 0;
}

export function catchUpFingerprint(p: CatchUpPayload): string {
  const key = JSON.stringify({
    c: [p.created, p.completed, p.blocked, p.assignedToMe],
    h: p.highlights.map((h) => [h.taskId, h.what]),
  });
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export async function gatherCatchUp(
  propertyId: string,
  userId: string,
  subjectKind: CatchUpSubjectKind,
  subjectId: string,
  since: string,
): Promise<CatchUpPayload> {
  const supabase = createServiceClient();
  const sinceClamped = new Date(
    Math.max(new Date(since).getTime(), Date.now() - MAX_WINDOW_MS),
  ).toISOString();

  const scopePath =
    subjectKind === "project"
      ? "payload->new->>project_id"
      : "payload->new->>space_id";
  const { data } = await supabase
    .from("workflow_events")
    .select(
      `event_type, entity_id, received_at, to:payload->>to, assignee:payload->new->>assignee_id, title:payload->new->>title, scope_id:${scopePath}` as string,
    )
    .eq("property_id", propertyId)
    .in("event_type", ["task.created", "task.status_changed", "task.assigned"])
    .gte("received_at", sinceClamped)
    .order("received_at", { ascending: false })
    .limit(2000);

  type Ev = {
    event_type: string;
    entity_id: string | null;
    received_at: string;
    to: string | null;
    assignee: string | null;
    title: string | null;
    scope_id: string | null;
  };
  const payload: CatchUpPayload = {
    since: sinceClamped,
    created: 0,
    completed: 0,
    blocked: 0,
    assignedToMe: 0,
    highlights: [],
  };
  const seenHighlight = new Set<string>();
  for (const e of ((data ?? []) as unknown as Ev[])) {
    if (e.scope_id !== subjectId) continue;
    let what: string | null = null;
    if (e.event_type === "task.created") {
      payload.created += 1;
      what = "created";
    } else if (e.event_type === "task.status_changed" && e.to === "done") {
      payload.completed += 1;
      what = "completed";
    } else if (e.event_type === "task.status_changed" && e.to === "blocked") {
      payload.blocked += 1;
      what = "blocked";
    } else if (e.event_type === "task.assigned" && e.assignee === userId) {
      payload.assignedToMe += 1;
      what = "assigned to you";
    }
    if (
      what &&
      e.entity_id &&
      payload.highlights.length < 10 &&
      !seenHighlight.has(`${e.entity_id}:${what}`)
    ) {
      seenHighlight.add(`${e.entity_id}:${what}`);
      payload.highlights.push({
        taskId: e.entity_id,
        title: e.title ?? "Untitled task",
        what,
        at: e.received_at,
      });
    }
  }
  return payload;
}
