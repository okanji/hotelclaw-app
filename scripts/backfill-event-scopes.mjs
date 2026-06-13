/**
 * One-off backfill: the first seed-insights-demo run wrote synthetic
 * task.status_changed events whose payload.new lacked project_id/space_id,
 * so project/space-scoped insights miss those transitions. Patch each event's
 * payload.new from its task row. Safe to delete after running.
 *
 *   node --env-file=.env.local scripts/backfill-event-scopes.mjs
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const lock = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scripts", "demo-seed.lock.json"), "utf8"),
);

const { data: events } = await sb
  .from("workflow_events")
  .select("id, entity_id, payload")
  .eq("property_id", lock.propertyId)
  .eq("event_type", "task.status_changed")
  .is("payload->new->>project_id", null)
  .limit(500);

const taskIds = [...new Set((events ?? []).map((e) => e.entity_id).filter(Boolean))];
const { data: tasks } = await sb
  .from("tasks")
  .select("id, project_id, space_id, title")
  .in("id", taskIds.length ? taskIds : ["00000000-0000-0000-0000-000000000000"]);
const byId = new Map((tasks ?? []).map((t) => [t.id, t]));

let patched = 0;
for (const ev of events ?? []) {
  const task = byId.get(ev.entity_id);
  if (!task || (!task.project_id && !task.space_id)) continue;
  const payload = ev.payload ?? {};
  payload.new = {
    ...(payload.new ?? {}),
    project_id: task.project_id,
    space_id: task.space_id,
  };
  if (payload.old) {
    payload.old = { ...payload.old, project_id: task.project_id, space_id: task.space_id };
  }
  const { error } = await sb
    .from("workflow_events")
    .update({ payload })
    .eq("id", ev.id);
  if (error) console.warn(`event ${ev.id}: ${error.message}`);
  else patched++;
}
console.log(`✓ Patched ${patched} events with project/space scope`);
await sb.from("insight_briefs").delete().eq("property_id", lock.propertyId);
console.log("✓ Brief cache cleared for the demo property");
