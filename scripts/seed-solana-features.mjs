/**
 * Solana Cove feature seeder — additive demo data for the newer surfaces:
 *
 *   • Labels applied to documents, projects, and spaces (the join tables
 *     shipped empty; tasks already carry text labels) so label chips and
 *     the "Manage labels" dialog have something real to show.
 *   • Three published forms with realistic schemas + responses from demo
 *     personas (and one draft), so the Documents-section Forms group and
 *     the forms list with response counts look alive.
 *   • Meeting RSVP variety — attendee responses move from all-pending to a
 *     deterministic accepted/tentative/declined mix so the calendar event
 *     modal's guest list and "N yes, M awaiting" summary demo well.
 *
 * Re-runnable: label applications upsert on their PKs, demo forms are
 * deleted by title and re-inserted, RSVPs are a deterministic function of
 * (meeting id, user id).
 *
 * Run: node --env-file=.env.local --no-network-family-autoselection scripts/seed-solana-features.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const PROPERTY_ID =
  process.env.SEED_PROPERTY_ID ?? "d58fc73b-9077-404d-9f2b-6eb56902d91a";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: property } = await supabase
  .from("properties")
  .select("id, name")
  .eq("id", PROPERTY_ID)
  .single();
if (!property) {
  console.error(`Property ${PROPERTY_ID} not found.`);
  process.exit(1);
}
console.log(`Seeding feature demo data into ${property.name}\n`);

/** Tiny deterministic hash so re-runs land identical data. */
function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}
const pick = (arr, seed) => arr[hash(seed) % arr.length];

// ── Load the cast ───────────────────────────────────────────────────────────

const { data: labels } = await supabase
  .from("labels")
  .select("id, name")
  .eq("property_id", PROPERTY_ID);
const labelByName = new Map((labels ?? []).map((l) => [l.name, l.id]));

const { data: members } = await supabase
  .from("memberships")
  .select("user_id")
  .eq("property_id", PROPERTY_ID);
const memberIds = (members ?? []).map((m) => m.user_id);
if (memberIds.length === 0) {
  console.error("No members — run the main demo seeder first.");
  process.exit(1);
}
const creator = memberIds[hash("creator") % memberIds.length];

// ── 1. Labels on projects / spaces / documents ──────────────────────────────

// Keyword → label-name routing. First match wins per bucket; everything
// gets at most 2 labels so chips stay tasteful.
const ROUTES = [
  [/renovation|reno|refresh|upgrade/i, ["budget", "vendor"]],
  [/wedding|event|banquet|party/i, ["guest-request", "recurring"]],
  [/safety|fire|emergency|compliance|audit|inspection/i, ["safety", "compliance"]],
  [/spa|wellness|relaunch/i, ["vip", "budget"]],
  [/menu|f&b|food|kitchen|restaurant|bar/i, ["inventory", "vendor"]],
  [/housekeeping|linen|laundry/i, ["recurring", "inventory"]],
  [/maintenance|repair|hvac|pool|engineering/i, ["maintenance", "urgent"]],
  [/guest|front office|reception|arrival/i, ["guest-request", "vip"]],
  [/budget|finance|revenue|ota/i, ["budget", "compliance"]],
];
function routeLabels(title) {
  for (const [re, names] of ROUTES) {
    if (re.test(title)) {
      return names.map((n) => labelByName.get(n)).filter(Boolean);
    }
  }
  return [labelByName.get(pick(["recurring", "maintenance", "vendor"], title))].filter(Boolean);
}

async function applyLabels(table, fkColumn, rows) {
  const inserts = [];
  for (const row of rows) {
    for (const labelId of routeLabels(row.title ?? row.name ?? "")) {
      inserts.push({ [fkColumn]: row.id, label_id: labelId, created_by: creator });
    }
  }
  if (inserts.length === 0) return 0;
  const { error } = await supabase
    .from(table)
    .upsert(inserts, { onConflict: `${fkColumn},label_id` });
  if (error) throw new Error(`${table}: ${error.message}`);
  return inserts.length;
}

const { data: projects } = await supabase
  .from("projects")
  .select("id, name")
  .eq("property_id", PROPERTY_ID);
const { data: spaces } = await supabase
  .from("spaces")
  .select("id, name")
  .eq("property_id", PROPERTY_ID);
const { data: documents } = await supabase
  .from("documents")
  .select("id, title")
  .eq("property_id", PROPERTY_ID)
  .is("archived_at", null)
  .limit(14);

console.log(`project labels:  ${await applyLabels("project_labels", "project_id", projects ?? [])}`);
console.log(`space labels:    ${await applyLabels("space_labels", "space_id", spaces ?? [])}`);
console.log(`document labels: ${await applyLabels("document_labels", "document_id", documents ?? [])}`);

// ── 2. Forms + responses ────────────────────────────────────────────────────

const f = (id, type, label, extra = {}) => ({ id, type, label, ...extra });

const FORMS = [
  {
    title: "Guest incident report",
    icon: "🚨",
    description:
      "Log any guest-affecting incident — the duty manager reviews these every morning.",
    status: "published",
    allow_multiple: true,
    anonymous: false,
    schema: {
      version: 1,
      fields: [
        f("guest_name", "short_text", "Guest name", { required: true }),
        f("room", "short_text", "Room / location", { required: true, placeholder: "e.g. Villa 12" }),
        f("severity", "select", "Severity", {
          required: true,
          options: [
            { id: "low", label: "Low — note for the file" },
            { id: "medium", label: "Medium — follow-up needed" },
            { id: "high", label: "High — manager attention today" },
          ],
        }),
        f("what_happened", "long_text", "What happened?", { required: true }),
        f("guest_informed", "yes_no", "Has the guest been given a resolution?"),
        f("incident_date", "date", "Date of incident", { required: true }),
      ],
    },
    responses: [
      {
        guest_name: "Mr. & Mrs. Calloway",
        room: "Villa 12",
        severity: "high",
        what_happened:
          "AC failed during turndown; honeymoon suite at 28°C. Moved guests to Villa 8 for the night, engineering ticket raised, champagne sent as apology.",
        guest_informed: true,
        incident_date: daysAgo(2),
      },
      {
        guest_name: "Daniela Reyes",
        room: "Oceanfront 304",
        severity: "medium",
        what_happened:
          "Rainfall showerhead dripping overnight, guest reported poor sleep. Maintenance swapped the cartridge same day; late checkout offered.",
        guest_informed: true,
        incident_date: daysAgo(4),
      },
      {
        guest_name: "Walk-in (pool deck)",
        room: "Pool deck, north steps",
        severity: "low",
        what_happened:
          "Guest slipped on wet tile — no injury, declined assistance. Wet-floor signage repositioned and housekeeping increased mop rounds.",
        guest_informed: false,
        incident_date: daysAgo(1),
      },
      {
        guest_name: "Tobias Werner",
        room: "Suite 210",
        severity: "medium",
        what_happened:
          "Minibar charged for items not consumed (sensor mis-read). Charges reversed, F&B notified to recalibrate the unit.",
        guest_informed: true,
        incident_date: daysAgo(6),
      },
    ],
  },
  {
    title: "Maintenance request",
    icon: "🔧",
    description:
      "Anything broken, leaking, flickering, or squeaking — engineering triages twice a day.",
    status: "published",
    allow_multiple: true,
    anonymous: false,
    schema: {
      version: 1,
      fields: [
        f("area", "select", "Area", {
          required: true,
          options: [
            { id: "rooms", label: "Guest rooms / villas" },
            { id: "fnb", label: "Restaurant & bar" },
            { id: "pool", label: "Pool & spa" },
            { id: "boh", label: "Back of house" },
            { id: "grounds", label: "Grounds & exterior" },
          ],
        }),
        f("location", "short_text", "Exact location", { required: true }),
        f("issue", "long_text", "Describe the issue", { required: true }),
        f("urgency", "rating", "Urgency", { maxRating: 5, description: "5 = guest-affecting right now" }),
        f("safe_to_use", "yes_no", "Is the area still safe to use?"),
      ],
    },
    responses: [
      { area: "pool", location: "Spa plunge pool, jet bank 2", issue: "Two jets pulsing irregularly — pump bearing noise audible from the plant room.", urgency: 3, safe_to_use: true },
      { area: "fnb", location: "Terrace service bar", issue: "Glasswasher tripping the breaker mid-cycle. Running glassware to the main kitchen meanwhile.", urgency: 4, safe_to_use: true },
      { area: "rooms", location: "Villa 3 bathroom", issue: "Extractor fan rattles at low speed; guest in-house, please schedule around 11am housekeeping window.", urgency: 2, safe_to_use: true },
      { area: "grounds", location: "Beach path, lantern 7", issue: "Solar lantern post leaning after the storm — base concrete cracked.", urgency: 2, safe_to_use: false },
      { area: "boh", location: "Loading dock roller door", issue: "Door stops 30cm short of fully open; deliveries squeezing under.", urgency: 3, safe_to_use: true },
    ],
  },
  {
    title: "Shift handover checklist",
    icon: "🌗",
    description: "Two minutes at end of shift so the next crew starts warm.",
    status: "published",
    allow_multiple: true,
    anonymous: false,
    schema: {
      version: 1,
      fields: [
        f("desk_clear", "yes_no", "Front desk queue cleared?", { required: true }),
        f("vips", "short_text", "VIPs in-house tonight", { placeholder: "Names / villas" }),
        f("open_items", "long_text", "Open items for the next shift", { required: true }),
        f("shift_rating", "rating", "How did the shift go?", { maxRating: 5 }),
      ],
    },
    responses: [
      { desk_clear: true, vips: "Calloways (V12), Ito party (V1–V2)", open_items: "Late arrival 23:40 — flight delayed, room key pre-cut at desk. Spa relaunch banner still needs sign-off.", shift_rating: 4 },
      { desk_clear: false, vips: "Ito party (V1–V2)", open_items: "Two checkouts disputing minibar; folios flagged. Beach bonfire setup at 19:00 needs a runner.", shift_rating: 3 },
      { desk_clear: true, vips: "—", open_items: "Quiet night. Pool towel par low — laundry notified for the 06:00 run.", shift_rating: 5 },
    ],
  },
  {
    title: "Banquet event intake",
    icon: "🎪",
    description: "Draft — sales to finalize fields with the events team.",
    status: "draft",
    allow_multiple: true,
    anonymous: false,
    schema: {
      version: 1,
      fields: [
        f("event_name", "short_text", "Event name", { required: true }),
        f("event_date", "date", "Date", { required: true }),
        f("headcount", "number", "Expected headcount", { min: 10, max: 400 }),
        f("notes", "long_text", "Notes"),
      ],
    },
    responses: [],
  },
];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Replace prior runs of these demo forms wholesale (responses cascade).
await supabase
  .from("forms")
  .delete()
  .eq("property_id", PROPERTY_ID)
  .in("title", FORMS.map((x) => x.title));

let responseTotal = 0;
for (const def of FORMS) {
  const { data: form, error } = await supabase
    .from("forms")
    .insert({
      property_id: PROPERTY_ID,
      title: def.title,
      description: def.description,
      icon: def.icon,
      schema: def.schema,
      status: def.status,
      allow_multiple: def.allow_multiple,
      anonymous: def.anonymous,
      created_by: creator,
    })
    .select("id")
    .single();
  if (error) throw new Error(`form ${def.title}: ${error.message}`);

  if (def.responses.length > 0) {
    const rows = def.responses.map((answers, i) => ({
      id: randomUUID(),
      form_id: form.id,
      property_id: PROPERTY_ID,
      respondent_id: memberIds[hash(def.title + i) % memberIds.length],
      answers,
      source: i % 3 === 1 ? "chat" : "direct",
      created_at: new Date(Date.now() - (i + 1) * 11 * 3600_000).toISOString(),
    }));
    const { error: rErr } = await supabase.from("form_responses").insert(rows);
    if (rErr) throw new Error(`responses ${def.title}: ${rErr.message}`);
    responseTotal += rows.length;
  }
}
console.log(`forms:           ${FORMS.length} (${responseTotal} responses)`);

// ── 3. Meeting RSVP variety ─────────────────────────────────────────────────

const { data: meetings } = await supabase
  .from("meetings")
  .select("id, host_id, attendees:meeting_attendees(user_id, is_organizer)")
  .eq("property_id", PROPERTY_ID);

let rsvps = 0;
for (const m of meetings ?? []) {
  for (const a of m.attendees ?? []) {
    const organizer = m.host_id ? a.user_id === m.host_id : a.is_organizer;
    if (organizer) continue;
    // Deterministic mix: ~50% accepted, ~20% tentative, ~10% declined.
    const roll = hash(m.id + a.user_id) % 10;
    const response =
      roll < 5 ? "accepted" : roll < 7 ? "tentative" : roll < 8 ? "declined" : "pending";
    if (response === "pending") continue;
    const { error } = await supabase
      .from("meeting_attendees")
      .update({ response })
      .eq("meeting_id", m.id)
      .eq("user_id", a.user_id);
    if (error) throw new Error(`rsvp: ${error.message}`);
    rsvps++;
  }
}
console.log(`meeting RSVPs:   ${rsvps} updated across ${meetings?.length ?? 0} meetings`);

console.log("\nDone.");
