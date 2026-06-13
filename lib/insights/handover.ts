import "server-only";
/**
 * Handover gather — the shift window's activity, collected deterministically
 * for the "Draft my handover" flow. The model turns this into four markdown
 * sections the author edits and publishes under their own name; it never
 * adds facts of its own.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { computeInsightsMetrics, type AttentionItem } from "./metrics";

const MAX_WINDOW_MS = 12 * 60 * 60 * 1000;

export type HandoverWindow = {
  windowStart: string;
  windowEnd: string;
  /** Named task movements in the window, newest first (≤30). */
  taskEvents: { taskId: string; title: string; what: string; at: string }[];
  /** The current attention list (blocked / overdue / slip / unassigned). */
  attention: AttentionItem[];
  decisions: { meetingTitle: string; decision: string }[];
  automationFailures: { name: string; error: string | null }[];
};

/** Default window = the caller's shift-brief cursor, clamped to ≤12h back. */
export async function gatherHandoverWindow(
  propertyId: string,
  userId: string,
  windowStart?: string,
): Promise<HandoverWindow> {
  const supabase = createServiceClient();
  const now = Date.now();

  let start = windowStart ? new Date(windowStart).getTime() : NaN;
  if (Number.isNaN(start)) {
    const { data: cursor } = await supabase
      .from("shift_briefs")
      .select("last_seen_at")
      .eq("property_id", propertyId)
      .eq("user_id", userId)
      .maybeSingle();
    start = cursor?.last_seen_at
      ? new Date(cursor.last_seen_at).getTime()
      : now - MAX_WINDOW_MS;
  }
  start = Math.max(start, now - MAX_WINDOW_MS);
  const sinceIso = new Date(start).toISOString();

  const [metrics, eventsRes, meetingsRes, runsRes] = await Promise.all([
    computeInsightsMetrics(propertyId),
    supabase
      .from("workflow_events")
      .select(
        "event_type, entity_id, received_at, to:payload->>to, title:payload->new->>title" as string,
      )
      .eq("property_id", propertyId)
      .in("event_type", ["task.created", "task.status_changed"])
      .gte("received_at", sinceIso)
      .order("received_at", { ascending: false })
      .limit(500),
    supabase
      .from("meetings")
      .select("id, title, started_at, meeting_summaries(decisions)")
      .eq("property_id", propertyId)
      .gte("started_at", sinceIso),
    supabase
      .from("workflow_runs")
      .select("workflow_id, status, error, workflows(name)")
      .eq("property_id", propertyId)
      .eq("status", "failed")
      .gte("started_at", sinceIso)
      .limit(10),
  ]);

  type Ev = {
    event_type: string;
    entity_id: string | null;
    received_at: string;
    to: string | null;
    title: string | null;
  };
  const taskEvents = ((eventsRes.data ?? []) as unknown as Ev[])
    .map((e) => {
      const what =
        e.event_type === "task.created"
          ? "created"
          : e.to === "done"
            ? "completed"
            : e.to === "blocked"
              ? "blocked"
              : e.to
                ? `moved to ${e.to.replace("_", " ")}`
                : null;
      return what && e.entity_id
        ? {
            taskId: e.entity_id,
            title: e.title ?? "Untitled task",
            what,
            at: e.received_at,
          }
        : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .slice(0, 30);

  const decisions: HandoverWindow["decisions"] = [];
  for (const m of (meetingsRes.data ?? []) as unknown as {
    title: string;
    meeting_summaries: { decisions: string[] | null }[] | null;
  }[]) {
    for (const s of m.meeting_summaries ?? []) {
      for (const d of s.decisions ?? []) {
        decisions.push({ meetingTitle: m.title, decision: d });
      }
    }
  }

  const automationFailures = (
    (runsRes.data ?? []) as unknown as {
      error: string | null;
      workflows: { name: string } | null;
    }[]
  ).map((r) => ({ name: r.workflows?.name ?? "Unknown workflow", error: r.error }));

  return {
    windowStart: sinceIso,
    windowEnd: new Date(now).toISOString(),
    taskEvents,
    attention: metrics.attention.slice(0, 15),
    decisions: decisions.slice(0, 10),
    automationFailures,
  };
}
