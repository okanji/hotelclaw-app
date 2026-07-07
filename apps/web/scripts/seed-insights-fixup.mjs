/**
 * One-off fixup for the two sections that failed in the first
 * seed-insights-demo run (workflow_runs missing `mode`, documents using the
 * dropped `body_snippet` column). Safe to delete after running.
 *
 *   node --env-file=.env.local scripts/seed-insights-fixup.mjs
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const uuid = () => crypto.randomUUID();
const DAY = 86_400_000;

const lock = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scripts", "demo-seed.lock.json"), "utf8"),
);
const propertyId = lock.propertyId;

// The empty workflows from the failed run — reuse them for the runs.
const { data: wfs } = await sb
  .from("workflows")
  .select("id, name")
  .eq("property_id", propertyId)
  .in("name", ["Escalate overdue urgent tasks", "Sync nightly PMS room status"]);
const wfHealthy = wfs?.find((w) => w.name.startsWith("Escalate"))?.id;
const wfFlaky = wfs?.find((w) => w.name.startsWith("Sync"))?.id;
if (!wfHealthy || !wfFlaky) {
  console.error("Seeded workflows not found — run seed-insights-demo.mjs first.");
  process.exit(1);
}

const runs = [];
for (let d = 6; d >= 0; d--) {
  const dayStart = Date.now() - d * DAY;
  for (let i = 0; i < 2 + (d % 2); i++) {
    const started = new Date(dayStart - 20 * 3_600_000 + i * 5 * 3_600_000);
    runs.push({
      workflow_id: wfHealthy,
      property_id: propertyId,
      status: "succeeded",
      mode: "instant",
      trigger_kind: "event",
      started_at: started.toISOString(),
      finished_at: new Date(started.getTime() + 25_000 + Math.random() * 40_000).toISOString(),
    });
  }
  const nightly = new Date(dayStart - 22 * 3_600_000);
  const failed = d <= 2;
  runs.push({
    workflow_id: wfFlaky,
    property_id: propertyId,
    status: failed ? "failed" : "succeeded",
    mode: "instant",
    trigger_kind: "schedule",
    started_at: nightly.toISOString(),
    finished_at: new Date(nightly.getTime() + 60_000).toISOString(),
    error: failed ? "PMS bridge returned 502 after 3 retries (upstream maintenance?)" : null,
  });
}
const { error: runErr } = await sb.from("workflow_runs").insert(runs);
console.log(runErr ? `runs: ${runErr.message}` : `✓ ${runs.length} workflow runs`);

const { data: space } = await sb
  .from("spaces")
  .select("id, name")
  .eq("property_id", propertyId)
  .is("archived_at", null)
  .order("position")
  .limit(1)
  .maybeSingle();
const { data: owner } = await sb
  .from("memberships")
  .select("user_id")
  .eq("property_id", propertyId)
  .limit(1)
  .maybeSingle();

const SOPS = [
  { title: "SOP: Walk-in freezer temperature log", staleDays: 92 },
  { title: "SOP: Guest lost & found handling", staleDays: 74 },
  { title: "SOP: Fire evacuation assembly points", staleDays: 12 },
];
let pinPos = 50_000;
let pinned = 0;
for (const s of SOPS) {
  const id = uuid();
  const { error } = await sb.from("documents").insert({
    id,
    property_id: propertyId,
    title: s.title,
    kind: "doc",
    position: pinPos,
    space_id: space?.id ?? null,
    created_by: owner?.user_id ?? null,
    last_edited_by: owner?.user_id ?? null,
    body_text: "Standard operating procedure — review quarterly.",
    created_at: new Date(Date.now() - (s.staleDays + 30) * DAY).toISOString(),
    updated_at: new Date(Date.now() - s.staleDays * DAY).toISOString(),
  });
  if (error) {
    console.warn(`doc "${s.title}": ${error.message}`);
    continue;
  }
  const { error: pinErr } = await sb.from("space_pinned_resources").insert({
    space_id: space.id,
    document_id: id,
    position: pinPos++,
  });
  if (pinErr) console.warn(`pin: ${pinErr.message}`);
  else pinned++;
}
console.log(`✓ ${pinned} pinned SOPs in "${space?.name}"`);
await sb.from("insight_briefs").delete().eq("property_id", propertyId);
console.log("✓ Brief cache cleared");
