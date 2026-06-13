/**
 * Additive Insights demo seeder — layers HISTORY and operational signals onto
 * the property created by seed-demo.mjs, so every Insights feature lights up:
 *
 *   - 8 weeks of created/completed task events → Flow chart, velocity,
 *     cycle time (improving), per-person throughput sparklines
 *   - a deliberate completion DIP this week vs a rising prior month →
 *     anomaly + week-over-week trend signals for the intelligence brief
 *   - blocked (aged), overdue, and unassigned-urgent open tasks → Attention
 *   - one at-risk, one behind-pace, one on-pace project → Portfolio flags
 *   - one overloaded assignee → load-imbalance signal in Workload
 *   - meetings this week with summaries (action items, some unowned) →
 *     Operations meeting outcomes + per-person meeting hours
 *   - two workflows with succeeded/failed runs → Automation health
 *   - stale pinned SOP docs (70-90 days untouched) → Knowledge section
 *   - pending invites → owner Team extras
 *
 *   node --env-file=.env.local scripts/seed-insights-demo.mjs
 *   node --env-file=.env.local scripts/seed-insights-demo.mjs --property <id>
 *
 * Idempotent-ish: everything it creates is tagged (task titles, stream_call_id
 * prefix `demo-ins-`, workflow names) and attached to the demo property, so a
 * seed-demo --reset still removes it via the property cascade. Synthetic
 * workflow_events are inserted pre-dispatched (dispatched_at set) so the
 * workflow engine never tries to run automations against backdated history.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase env. Run with --env-file=.env.local");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const uuid = () => crypto.randomUUID();
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/* ── Resolve target property ───────────────────────────────────────────────── */

const argIdx = process.argv.indexOf("--property");
let propertyId = argIdx > -1 ? process.argv[argIdx + 1] : null;
if (!propertyId) {
  const lockPath = path.join(process.cwd(), "scripts", "demo-seed.lock.json");
  if (fs.existsSync(lockPath)) {
    propertyId = JSON.parse(fs.readFileSync(lockPath, "utf8")).propertyId;
  }
}
if (!propertyId) {
  console.error("No property id — pass --property <id> or run seed-demo.mjs first.");
  process.exit(1);
}

const { data: property } = await sb
  .from("properties")
  .select("id, name")
  .eq("id", propertyId)
  .maybeSingle();
if (!property) {
  console.error(`Property ${propertyId} not found.`);
  process.exit(1);
}
console.log(`Seeding Insights demo data into "${property.name}" (${propertyId})`);

/* ── Load cast: members, projects, spaces ──────────────────────────────────── */

const { data: members } = await sb
  .from("memberships")
  .select("user_id, role")
  .eq("property_id", propertyId);
const userIds = (members ?? []).map((m) => m.user_id);
const { data: profiles } = await sb
  .from("profiles")
  .select("id, full_name")
  .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
const people = (profiles ?? []).map((p) => ({
  id: p.id,
  name: p.full_name ?? "Unknown",
  role: members.find((m) => m.user_id === p.id)?.role ?? "staff",
}));
const staff = people.filter((p) => p.role !== "owner");
const assignees = (staff.length >= 4 ? staff : people).slice(0, 6);
if (assignees.length === 0) {
  console.error("No members to assign tasks to — run seed-demo.mjs first.");
  process.exit(1);
}
const overloaded = assignees[0];
console.log(
  `✓ Cast: ${people.length} members, assigning across ${assignees.length} (overloading ${overloaded.name})`,
);

const { data: projectRows } = await sb
  .from("projects")
  .select("id, name, position")
  .eq("property_id", propertyId)
  .is("archived_at", null)
  .order("position")
  .limit(3);
const [projAtRisk, projBehind, projOnPace] = projectRows ?? [];

const { data: spaceRows } = await sb
  .from("spaces")
  .select("id, name")
  .eq("property_id", propertyId)
  .is("archived_at", null)
  .order("position")
  .limit(1);
const pinSpace = spaceRows?.[0] ?? null;

/* ── Shape project schedules for the pace flags ────────────────────────────── */

const today = new Date();
const dateStr = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
const dateInStr = (msAhead) =>
  new Date(Date.now() + msAhead).toISOString().slice(0, 10);

if (projAtRisk) {
  await sb
    .from("projects")
    .update({
      status: "active",
      start_date: dateStr(30 * DAY),
      target_date: dateInStr(10 * DAY),
    })
    .eq("id", projAtRisk.id);
}
if (projBehind) {
  await sb
    .from("projects")
    .update({
      status: "active",
      start_date: dateStr(60 * DAY),
      target_date: dateInStr(30 * DAY),
    })
    .eq("id", projBehind.id);
}
if (projOnPace) {
  await sb
    .from("projects")
    .update({
      status: "active",
      start_date: dateStr(40 * DAY),
      target_date: dateInStr(45 * DAY),
    })
    .eq("id", projOnPace.id);
}
console.log(
  `✓ Project schedules: at-risk="${projAtRisk?.name}", behind="${projBehind?.name}", on-pace="${projOnPace?.name}"`,
);

/* ── Task + event factories ────────────────────────────────────────────────── */

const taskIds = [];
let pos = 10_000;

async function insertTask(t) {
  const id = uuid();
  const { error } = await sb.from("tasks").insert({
    id,
    property_id: propertyId,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    priority: t.priority ?? "medium",
    assignee_id: t.assigneeId ?? null,
    created_by: t.assigneeId ?? assignees[0].id,
    project_id: t.projectId ?? null,
    due_at: t.dueAt ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt ?? t.createdAt,
    position: pos++,
  });
  if (error) throw new Error(`task "${t.title}": ${error.message}`);
  taskIds.push(id);
  return id;
}

/** Synthetic status transition, backdated + pre-dispatched. The payload.new
 *  row snapshot must mirror what the real trigger emits (to_jsonb(new)) —
 *  scoped insights filter on payload->new->>project_id / space_id. */
async function insertTransition(taskId, t) {
  const newRow = {
    id: taskId,
    status: t.to,
    assignee_id: t.assigneeId ?? null,
    project_id: t.projectId ?? null,
    space_id: t.spaceId ?? null,
    property_id: propertyId,
  };
  const { error } = await sb.from("workflow_events").insert({
    property_id: propertyId,
    source: "pg.tasks",
    event_type: "task.status_changed",
    entity_id: taskId,
    entity_kind: "task",
    payload: {
      from: t.from,
      to: t.to,
      old: { ...newRow, status: t.from },
      new: newRow,
    },
    received_at: t.at,
    dispatched_at: t.at,
  });
  if (error) throw new Error(`event for ${taskId}: ${error.message}`);
}

/* ── 1. Eight weeks of completed work (flow + cycle + throughput) ──────────── */

// Monday of the current week, local — matches metrics.weekStartOf.
const monday = new Date();
monday.setHours(0, 0, 0, 0);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

// Completions per week, oldest → current. Rising month, then this week dips:
// trailing-4-week mean ≈ 9.75 vs 2 now → "completion fell ~80%" anomaly.
const DONE_PER_WEEK = [4, 5, 6, 8, 9, 10, 12, 2];

const TITLES = [
  "Deep-clean banquet kitchen line",
  "Replace lobby planter lighting",
  "Recalibrate room 3F thermostats",
  "Restock minibar par levels",
  "Patch guest wifi dead zone, east wing",
  "Service pool filtration pump",
  "Update allergen matrix for spring menu",
  "Fix squeaky ballroom door hinges",
  "Inventory linen room",
  "Test kitchen fire-suppression nozzles",
  "Repaint loading dock bollards",
  "Descale espresso machines",
  "Audit key-card encoder firmware",
  "Replace cracked tile, spa entrance",
  "Refresh concierge city guide",
  "Rotate walk-in freezer stock",
  "Re-lamp parking structure level 2",
  "Clean grease trap, main kitchen",
  "Verify AED pads expiry dates",
  "Tune banquet AV rack",
];

let titleIdx = 0;
const nextTitle = () => {
  const t = TITLES[titleIdx % TITLES.length];
  const round = Math.floor(titleIdx / TITLES.length);
  titleIdx++;
  return round > 0 ? `${t} (${round + 1})` : t;
};

let doneCount = 0;
for (let w = 0; w < DONE_PER_WEEK.length; w++) {
  const weekStart = monday.getTime() - (DONE_PER_WEEK.length - 1 - w) * WEEK;
  for (let i = 0; i < DONE_PER_WEEK[w]; i++) {
    const person = assignees[(doneCount + i) % assignees.length];
    // Done somewhere inside the week (current week: within its first 2 days
    // so everything stays in the past).
    const span = w === DONE_PER_WEEK.length - 1 ? 2 * DAY : 6 * DAY;
    const doneAt = new Date(weekStart + Math.random() * span + 9 * 3_600_000);
    // Older completions took ~3-7 days, recent ones ~1-4 → cycle time improving.
    const leadDays = w < 4 ? 3 + Math.random() * 4 : 1 + Math.random() * 3;
    const createdAt = new Date(doneAt.getTime() - leadDays * DAY);
    const projectId =
      doneCount % 4 === 0 && projOnPace
        ? projOnPace.id
        : doneCount % 7 === 0 && projBehind
          ? projBehind.id
          : null;
    const id = await insertTask({
      title: nextTitle(),
      status: "done",
      priority: ["low", "medium", "medium", "high"][doneCount % 4],
      assigneeId: person.id,
      projectId,
      createdAt: createdAt.toISOString(),
      updatedAt: doneAt.toISOString(),
    });
    await insertTransition(id, {
      from: "in_progress",
      to: "done",
      assigneeId: person.id,
      projectId,
      at: doneAt.toISOString(),
    });
    doneCount++;
  }
}
console.log(`✓ ${doneCount} completed tasks across 8 weeks (dip this week)`);

/* ── 2. Open work: blocked (aged), overdue, unassigned urgent, plain ──────── */

const open = [];

// Blocked, with real blocked-since transitions (16d, 9d, 5d).
const BLOCKED = [
  {
    title: "Repair walk-in freezer compressor",
    days: 16,
    priority: "urgent",
    assignee: overloaded,
    project: projAtRisk,
    description: "Parts on backorder from vendor — needs escalation.",
  },
  {
    title: "Renew elevator inspection certificate",
    days: 9,
    priority: "high",
    assignee: assignees[1] ?? overloaded,
    project: projAtRisk,
    description: "Waiting on city inspector callback.",
  },
  {
    title: "Approve rooftop bar furniture order",
    days: 5,
    priority: "medium",
    assignee: assignees[2] ?? overloaded,
    project: projBehind,
    description: "Budget sign-off pending from ownership group.",
  },
];
for (const b of BLOCKED) {
  const blockedAt = new Date(Date.now() - b.days * DAY);
  const createdAt = new Date(blockedAt.getTime() - 4 * DAY);
  const id = await insertTask({
    title: b.title,
    description: b.description,
    status: "blocked",
    priority: b.priority,
    assigneeId: b.assignee.id,
    projectId: b.project?.id ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: blockedAt.toISOString(),
  });
  await insertTransition(id, {
    from: "in_progress",
    to: "blocked",
    assigneeId: b.assignee.id,
    projectId: b.project?.id ?? null,
    at: blockedAt.toISOString(),
  });
  open.push(id);
}

// Overdue open tasks (3 on the overloaded person, 2 elsewhere).
const OVERDUE = [
  { title: "Submit Q3 maintenance budget", late: 13, who: overloaded, status: "in_progress", priority: "high", project: projAtRisk },
  { title: "Replace banquet hall projector lamp", late: 6, who: overloaded, status: "todo", priority: "medium", project: projAtRisk },
  { title: "File pool chemical usage report", late: 4, who: overloaded, status: "in_progress", priority: "medium", project: null },
  { title: "Order winter doormats", late: 8, who: assignees[3] ?? assignees[1], status: "todo", priority: "low", project: projBehind },
  { title: "Schedule hood vent deep clean", late: 2, who: assignees[1] ?? overloaded, status: "in_progress", priority: "high", project: projBehind },
];
for (const o of OVERDUE) {
  const id = await insertTask({
    title: o.title,
    status: o.status,
    priority: o.priority,
    assigneeId: o.who.id,
    projectId: o.project?.id ?? null,
    dueAt: new Date(Date.now() - o.late * DAY).toISOString(),
    createdAt: new Date(Date.now() - (o.late + 10) * DAY).toISOString(),
  });
  open.push(id);
}

// Unassigned urgent — the "silent urgent work" attention kind.
for (const u of [
  { title: "Investigate guest complaint: room 412 leak", priority: "urgent" },
  { title: "Replace cracked glass, main entrance", priority: "high" },
]) {
  open.push(
    await insertTask({
      title: u.title,
      status: "todo",
      priority: u.priority,
      assigneeId: null,
      createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
    }),
  );
}

// Plain open load: pile onto the overloaded person (load imbalance ≥2x
// median), sprinkle the rest. Mix of projects to shape completion %.
const plainOpen = [
  ...Array.from({ length: 6 }, (_, i) => ({
    who: overloaded,
    project: i < 3 ? projAtRisk : projBehind,
  })),
  ...assignees.slice(1, 5).flatMap((who, i) => [
    { who, project: i % 2 === 0 ? projBehind : projOnPace },
    { who, project: i % 2 === 0 ? projOnPace : null },
  ]),
];
for (let i = 0; i < plainOpen.length; i++) {
  const p = plainOpen[i];
  open.push(
    await insertTask({
      title: nextTitle(),
      status: i % 3 === 0 ? "in_progress" : "todo",
      priority: i % 5 === 0 ? "high" : "medium",
      assigneeId: p.who.id,
      projectId: p.project?.id ?? null,
      dueAt: new Date(Date.now() + (3 + (i % 10)) * DAY).toISOString(),
      createdAt: new Date(Date.now() - (1 + (i % 12)) * DAY).toISOString(),
    }),
  );
}
console.log(
  `✓ ${open.length} open tasks (3 blocked w/ aged transitions, 5 overdue, 2 unassigned urgent)`,
);

/* ── 3. Backdate the auto-emitted task.created events ──────────────────────── */

// The insert trigger stamped every task.created event with now(); pull each
// back to its task's real created_at so intake/flow history is honest, and
// mark everything dispatched so the workflow engine ignores the backfill.
const { data: createdEvents } = await sb
  .from("workflow_events")
  .select("id, entity_id")
  .eq("property_id", propertyId)
  .eq("event_type", "task.created")
  .in("entity_id", taskIds);
const { data: taskDates } = await sb
  .from("tasks")
  .select("id, created_at")
  .in("id", taskIds);
const createdAtById = new Map((taskDates ?? []).map((t) => [t.id, t.created_at]));
let backdated = 0;
for (const ev of createdEvents ?? []) {
  const at = createdAtById.get(ev.entity_id);
  if (!at) continue;
  await sb
    .from("workflow_events")
    .update({ received_at: at, dispatched_at: at })
    .eq("id", ev.id);
  backdated++;
}
console.log(`✓ Backdated ${backdated} task.created events to real creation dates`);

/* ── 4. Meetings this week (+ summaries with unowned action items) ─────────── */

const MEETINGS = [
  {
    title: "Monday ops standup",
    daysAgo: 1.2,
    hours: 0.5,
    actionItems: [
      { text: "Chase freezer compressor vendor for ETA", owner: overloaded.name },
      { text: "Post revised housekeeping rota", owner: null },
      { text: "Confirm inspector visit window", owner: null },
    ],
    decisions: ["Hold rooftop bar opening until furniture order clears"],
  },
  {
    title: "Renovation steering sync",
    daysAgo: 2.5,
    hours: 1.5,
    actionItems: [
      { text: "Re-sequence 3F room turns around tile delivery", owner: assignees[1]?.name ?? null },
      { text: "Get updated quote for spa entrance tile", owner: null },
    ],
    decisions: ["Move soft-opening target to the 24th"],
  },
  {
    title: "F&B menu review",
    daysAgo: 4,
    hours: 1,
    actionItems: [
      { text: "Finalize allergen matrix sign-off", owner: assignees[2]?.name ?? null },
    ],
    decisions: ["Drop the oyster program for summer", "Keep brunch pricing flat"],
  },
  {
    title: "Weekly leadership huddle",
    daysAgo: 5.5,
    hours: 1,
    actionItems: [
      { text: "Draft seasonal staffing plan", owner: null },
    ],
    decisions: [],
  },
];

let meetingCount = 0;
for (const m of MEETINGS) {
  const id = uuid();
  const start = new Date(Date.now() - m.daysAgo * DAY);
  const end = new Date(start.getTime() + m.hours * 3_600_000);
  const { error } = await sb.from("meetings").insert({
    id,
    property_id: propertyId,
    stream_call_id: `demo-ins-${id}`,
    title: m.title,
    host_id: assignees[meetingCount % assignees.length].id,
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
  });
  if (error) {
    console.warn(`  meeting "${m.title}": ${error.message}`);
    continue;
  }
  // Everyone on the workload board attends most meetings; one declines.
  await sb.from("meeting_attendees").insert(
    assignees.slice(0, 5).map((p, i) => ({
      meeting_id: id,
      user_id: p.id,
      response: i === 4 && meetingCount % 2 === 0 ? "declined" : "accepted",
      is_organizer: i === meetingCount % assignees.length,
    })),
  );
  const { error: sumErr } = await sb.from("meeting_summaries").insert({
    meeting_id: id,
    model: "demo-seed",
    summary_md: `Recap of ${m.title.toLowerCase()}: ${m.decisions[0] ?? "status updates across departments"}.`,
    action_items: m.actionItems,
    decisions: m.decisions,
  });
  if (sumErr) console.warn(`  summary "${m.title}": ${sumErr.message}`);
  meetingCount++;
}
console.log(
  `✓ ${meetingCount} meetings this week (+${MEETINGS.flatMap((m) => m.actionItems).filter((a) => !a.owner).length} unowned action items)`,
);

/* ── 5. Automation health: two workflows, runs over 7 days ─────────────────── */

async function insertWorkflow(name, description) {
  const id = uuid();
  const { error } = await sb.from("workflows").insert({
    id,
    property_id: propertyId,
    name,
    description,
    enabled: false, // never let the demo workflow actually fire
    mode: "instant",
    created_by: assignees[0].id,
  });
  if (error) throw new Error(`workflow "${name}": ${error.message}`);
  return id;
}

const wfHealthy = await insertWorkflow(
  "Escalate overdue urgent tasks",
  "Pings the manager channel when an urgent task goes overdue.",
);
const wfFlaky = await insertWorkflow(
  "Sync nightly PMS room status",
  "Pulls room-status changes from the PMS bridge every night.",
);

const runs = [];
for (let d = 6; d >= 0; d--) {
  const dayStart = Date.now() - d * DAY;
  // Healthy workflow: 2-3 clean runs/day.
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
  // Flaky workflow: nightly run, fails the last 3 nights.
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
{
  const { error } = await sb.from("workflow_runs").insert(runs);
  if (error) console.warn(`  workflow_runs: ${error.message}`);
  else
    console.log(
      `✓ ${runs.length} workflow runs (nightly PMS sync failing 3 nights straight)`,
    );
}

/* ── 6. Stale pinned SOPs ──────────────────────────────────────────────────── */

if (pinSpace) {
  const SOPS = [
    { title: "SOP: Walk-in freezer temperature log", staleDays: 92 },
    { title: "SOP: Guest lost & found handling", staleDays: 74 },
    { title: "SOP: Fire evacuation assembly points", staleDays: 12 }, // fresh control
  ];
  let pinPos = 50_000;
  let pinned = 0;
  for (const s of SOPS) {
    const id = uuid();
    const stamp = new Date(Date.now() - s.staleDays * DAY).toISOString();
    const { error } = await sb.from("documents").insert({
      id,
      property_id: propertyId,
      title: s.title,
      kind: "doc",
      position: pinPos,
      space_id: pinSpace.id,
      created_by: assignees[0].id,
      last_edited_by: assignees[0].id,
      body_text: "Standard operating procedure — review quarterly.",
      created_at: new Date(Date.now() - (s.staleDays + 30) * DAY).toISOString(),
      updated_at: stamp,
    });
    if (error) {
      console.warn(`  doc "${s.title}": ${error.message}`);
      continue;
    }
    const { error: pinErr } = await sb.from("space_pinned_resources").insert({
      space_id: pinSpace.id,
      document_id: id,
      position: pinPos++,
    });
    if (pinErr) console.warn(`  pin "${s.title}": ${pinErr.message}`);
    else pinned++;
  }
  console.log(`✓ ${pinned} pinned SOPs in "${pinSpace.name}" (2 stale, 1 fresh)`);
}

/* ── 7. Pending invites (owner Team extras) ────────────────────────────────── */

const invites = [
  { email: "night.auditor@candidate.example", role: "staff" },
  { email: "sous.chef@candidate.example", role: "staff" },
];
{
  const { error } = await sb.from("invites").insert(
    invites.map((i) => ({
      property_id: propertyId,
      email: i.email,
      role: i.role,
      token: crypto.randomBytes(24).toString("hex"),
      expires_at: new Date(Date.now() + 7 * DAY).toISOString(),
      created_by: assignees[0].id,
    })),
  );
  if (error) console.warn(`  invites: ${error.message}`);
  else console.log(`✓ ${invites.length} pending invites`);
}

/* ── 8. Invalidate cached AI artifacts so they regenerate from new data ────── */

await sb.from("insight_briefs").delete().eq("property_id", propertyId);
await sb.from("insight_annotations").delete().eq("property_id", propertyId);
await sb.from("insight_reports").delete().eq("property_id", propertyId);
console.log("✓ Cleared cached briefs/annotations/reports — they regenerate on next view");

console.log(`
Done. What to look at:
  Insights        → Intelligence brief (completion dip, freezer blocker, PMS
                    sync failures), Flow dip, Attention list, Open work mix
  Portfolio       → "${projAtRisk?.name ?? "-"}" at risk, "${projBehind?.name ?? "-"}" behind, "${projOnPace?.name ?? "-"}" on pace (+ Haiku notes)
  Workload        → ${overloaded.name} overloaded, throughput sparklines, meeting hours
  Operations      → 4 meetings / unowned action items, failing PMS sync, 2 stale SOPs, invites
  Reports         → Generate this week's report (note the dip narrative)
  Home            → Attention widget; project/space headers show stat strips
`);
