// Smoke test for the Insights metrics SQL shapes — runs the exact PostgREST
// selects lib/insights/metrics.ts issues (incl. the JSON-path aliases over
// workflow_events.payload) against the live database, plus a read of the new
// insight_reports table. Usage:
//   node --env-file=.env.local scripts/insights-smoke.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: props, error: propsErr } = await supabase
  .from("properties")
  .select("id, name")
  .limit(1);
if (propsErr) throw propsErr;
if (!props?.length) {
  console.log("no properties in db — nothing to test against");
  process.exit(0);
}
const pid = props[0].id;
console.log("property:", props[0].name);

const since = new Date(Date.now() - 8 * 7 * 864e5).toISOString();
const { data: events, error: eventsErr } = await supabase
  .from("workflow_events")
  .select(
    "event_type, entity_id, received_at, to:payload->>to, event_assignee:payload->new->>assignee_id",
  )
  .eq("property_id", pid)
  .in("event_type", ["task.created", "task.status_changed"])
  .gte("received_at", since)
  .order("received_at", { ascending: true })
  .limit(2000);
if (eventsErr) {
  console.error("EVENTS SELECT FAILED:", eventsErr.message);
  process.exit(1);
}
console.log(`events in window: ${events.length}`);
console.log("sample:", JSON.stringify(events.slice(0, 3), null, 2));

const doneCount = events.filter(
  (e) => e.event_type === "task.status_changed" && e.to === "done",
).length;
const withAssignee = events.filter((e) => e.event_assignee).length;
console.log(`done transitions: ${doneCount}, events with assignee: ${withAssignee}`);

const { data: reports, error: repErr } = await supabase
  .from("insight_reports")
  .select("id, period_start, audience")
  .eq("property_id", pid);
if (repErr) {
  console.error("INSIGHT_REPORTS SELECT FAILED:", repErr.message);
  process.exit(1);
}
console.log(`insight_reports queryable: yes (${reports.length} rows)`);
console.log("smoke test passed");
