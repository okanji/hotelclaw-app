/**
 * Remaining-surfaces seeder — fills the last empty internal/config tables so
 * every surface in the app has demo data:
 *
 *   • property_profiles   — the onboarding answers (resort type, departments,
 *                           priorities) the AI uses for context.
 *   • handovers           — published end-of-shift handovers (My Week →
 *                           "Latest handover"), 4-section markdown.
 *   • catch_ups           — per-user "what changed since you last looked"
 *                           summaries for a project + a space.
 *   • insight_follows     — email-digest subscriptions (property / project /
 *                           space) for a couple of managers.
 *   • insight_alert_rules — threshold alerts (overdue / blocked / at-risk).
 *   • email_prefs         — digest/alert opt-in rows for those users.
 *   • api_tokens          — developer API tokens (metadata; one revoked).
 *
 * Re-runnable: every write is an upsert on its natural key, or a
 * delete-by-marker then insert (handovers, api_tokens).
 *
 * Run: node --env-file=.env.local --no-network-family-autoselection scripts/seed-remaining-surfaces.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

const PROPERTY_ID =
  process.env.SEED_PROPERTY_ID ?? "d58fc73b-9077-404d-9f2b-6eb56902d91a";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: property, error: propErr } = await supabase
  .from("properties")
  .select("id, name")
  .eq("id", PROPERTY_ID)
  .single();
if (propErr || !property) {
  console.error(`Property ${PROPERTY_ID} not found: ${propErr?.message}`);
  process.exit(1);
}
console.log(`Seeding remaining surfaces into ${property.name}\n`);

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// ── Cast ─────────────────────────────────────────────────────────────────────
const { data: mems } = await supabase
  .from("memberships")
  .select("user_id, role")
  .eq("property_id", PROPERTY_ID);
if (!mems || mems.length === 0) {
  console.error("No members — run the main demo seeder first.");
  process.exit(1);
}
const managers = mems.filter((m) => m.role !== "staff").map((m) => m.user_id);
const someStaff = mems.map((m) => m.user_id);
const owner = managers[0] ?? someStaff[0];
const author2 = managers[1] ?? someStaff[1] ?? owner;

const { data: projects } = await supabase
  .from("projects")
  .select("id, name")
  .eq("property_id", PROPERTY_ID)
  .order("created_at")
  .limit(5);
const { data: spaces } = await supabase
  .from("spaces")
  .select("id, name")
  .eq("property_id", PROPERTY_ID)
  .order("created_at");
const { data: recentTasks } = await supabase
  .from("tasks")
  .select("id, title")
  .eq("property_id", PROPERTY_ID)
  .order("updated_at", { ascending: false })
  .limit(12);

// ── 1. property_profiles ─────────────────────────────────────────────────────
{
  const departments = (spaces ?? []).map((s) => s.name);
  const priorities = [
    "Guest feedback",
    "Maintenance requests",
    "Shift handovers",
    "Event & banquet coordination",
    "Revenue & OTA performance",
  ];
  const { error } = await supabase.from("property_profiles").upsert(
    {
      property_id: PROPERTY_ID,
      property_type: "Beach resort & spa",
      team_size: "50-200",
      departments,
      priorities,
      role_title: "General Manager",
      answers: {
        propertyName: property.name,
        propertyType: "Beach resort & spa",
        teamSize: "50-200",
        departments: departments.map((name) => ({ name })),
        roleTitle: "General Manager",
        priorities,
        inviteCount: mems.length - 1,
      },
    },
    { onConflict: "property_id" },
  );
  console.log(error ? `✗ property_profile: ${error.message}` : "✅ property profile");
}

// ── 2. handovers ─────────────────────────────────────────────────────────────
{
  await supabase
    .from("handovers")
    .delete()
    .eq("property_id", PROPERTY_ID)
    .like("body_md", "%<!--seed-->%");

  const rows = [
    {
      author: owner,
      hAgo: 10,
      body: `<!--seed-->
## Progress
- Spa relaunch soft-open went well — 18 covers, all positive
- Villa 12 AC fully repaired and re-inspected; guests moved back
- OTA rate parity corrected on Expedia; pacing back to plan

## New risks
- Banquet kitchen line still one cook short for Saturday's wedding (120 pax)
- Pool filtration pump showing the same bearing noise — engineering watching

## Blockers
- Awaiting GM sign-off on the spring menu allergen matrix before print

## For next shift
- Confirm the late 23:40 arrival (flight delayed) — key pre-cut at the desk
- Chase linen par levels; laundry short on pool towels for the 06:00 run`,
    },
    {
      author: author2,
      hAgo: 34,
      body: `<!--seed-->
## Progress
- Front office cleared the checkout queue by 11:15, no disputes outstanding
- Wedding walkthrough completed with the Oceanfront couple
- Kayak tour ran full (12/12); great reviews

## New risks
- Two minibar sensor mis-reads reported today — F&B to recalibrate units

## Blockers
- None

## For next shift
- VIP Calloways (Villa 12) anniversary — sparkling wine on turndown
- Beach bonfire setup at 19:00 needs a runner assigned`,
    },
  ];

  let n = 0;
  for (const r of rows) {
    const { error } = await supabase.from("handovers").insert({
      property_id: PROPERTY_ID,
      author_id: r.author,
      body_md: r.body,
      window_start: hoursAgo(r.hAgo + 8),
      window_end: hoursAgo(r.hAgo),
      created_at: hoursAgo(r.hAgo),
    });
    if (error) {
      console.error(`✗ handover: ${error.message}`);
      process.exit(1);
    }
    n++;
  }
  console.log(`✅ handovers (${n})`);
}

// ── 3. catch_ups (per-user) ──────────────────────────────────────────────────
{
  const proj = projects?.[0];
  const spaceRow = spaces?.find((s) => /food|beverage/i.test(s.name)) ?? spaces?.[0];
  const hi = (recentTasks ?? []).slice(0, 4).map((t, i) => ({
    taskId: t.id,
    title: t.title,
    what: ["moved to In progress", "completed", "blocked", "created"][i % 4],
    at: hoursAgo(6 + i * 5),
  }));
  const targets = [];
  if (proj)
    targets.push({
      kind: "project",
      id: proj.id,
      name: proj.name,
      payload: {
        since: hoursAgo(72),
        created: 3,
        completed: 4,
        blocked: 1,
        assignedToMe: 2,
        highlights: hi,
      },
      summary: `Since you last looked, 4 tasks wrapped and 3 new ones landed in ${proj.name} — "${hi[0]?.title ?? "a task"}" is the one to watch (now blocked).`,
    });
  if (spaceRow)
    targets.push({
      kind: "space",
      id: spaceRow.id,
      name: spaceRow.name,
      payload: {
        since: hoursAgo(72),
        created: 2,
        completed: 1,
        blocked: 0,
        assignedToMe: 1,
        highlights: hi.slice(0, 2),
      },
      summary: `${spaceRow.name} has been quiet — 1 task completed and 2 new requests came in since your last visit.`,
    });

  let n = 0;
  // Give a couple of managers their own catch-up rows.
  const readers = [owner, author2].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const uid of readers) {
    for (const t of targets) {
      const { error } = await supabase.from("catch_ups").upsert(
        {
          property_id: PROPERTY_ID,
          user_id: uid,
          subject_kind: t.kind,
          subject_id: t.id,
          last_seen_at: hoursAgo(72),
          payload: t.payload,
          summary_md: t.summary,
          fingerprint: `seed-${hash(uid + t.id)}`,
          generated_at: hoursAgo(1),
        },
        { onConflict: "property_id,user_id,subject_kind,subject_id" },
      );
      if (error) {
        console.error(`✗ catch_up: ${error.message}`);
        process.exit(1);
      }
      n++;
    }
  }
  console.log(`✅ catch_ups (${n})`);
}

// ── 4. email_prefs + insight_follows + insight_alert_rules ───────────────────
{
  // email_prefs for the managers who get digests/alerts.
  for (const uid of [owner, author2].filter(Boolean)) {
    await supabase
      .from("email_prefs")
      .upsert({ user_id: uid, digests_enabled: true, alerts_enabled: true }, {
        onConflict: "user_id",
      });
  }

  const proj = projects?.[0];
  const spaceRow = spaces?.[0];
  const follows = [
    { uid: owner, scope: "property", cadence: "weekly" },
    proj && { uid: owner, scope: `project:${proj.id}`, cadence: "daily" },
    spaceRow && { uid: author2, scope: `space:${spaceRow.id}`, cadence: "weekly" },
  ].filter(Boolean);

  let f = 0;
  for (const row of follows) {
    const { error } = await supabase.from("insight_follows").upsert(
      {
        user_id: row.uid,
        property_id: PROPERTY_ID,
        scope: row.scope,
        cadence: row.cadence,
      },
      { onConflict: "user_id,property_id,scope" },
    );
    if (error) {
      console.error(`✗ insight_follow: ${error.message}`);
      process.exit(1);
    }
    f++;
  }
  console.log(`✅ insight_follows (${f})`);

  const rules = [
    { uid: owner, scope: "property", metric: "overdue_count", threshold: 5 },
    { uid: owner, scope: "property", metric: "unassigned_urgent_count", threshold: 1 },
    proj && {
      uid: author2,
      scope: `project:${proj.id}`,
      metric: "project_at_risk",
      threshold: null,
    },
  ].filter(Boolean);

  let r = 0;
  for (const rule of rules) {
    const { error } = await supabase.from("insight_alert_rules").upsert(
      {
        user_id: rule.uid,
        property_id: PROPERTY_ID,
        scope: rule.scope,
        metric: rule.metric,
        threshold: rule.threshold,
        enabled: true,
      },
      { onConflict: "user_id,property_id,scope,metric" },
    );
    if (error) {
      console.error(`✗ insight_alert_rule: ${error.message}`);
      process.exit(1);
    }
    r++;
  }
  console.log(`✅ insight_alert_rules (${r})`);
}

// ── 5. api_tokens ────────────────────────────────────────────────────────────
{
  // Mirror lib/mcp/tokens.ts: token is `hc_<48hex>`, only the sha256 is stored.
  const mint = () => {
    const token = `hc_${randomBytes(24).toString("hex")}`;
    return createHash("sha256").update(token).digest("hex");
  };
  await supabase
    .from("api_tokens")
    .delete()
    .eq("property_id", PROPERTY_ID)
    .like("name", "%(demo)%");

  const tokens = [
    { name: "Booking widget — website (demo)", lastUsed: hoursAgo(3), revoked: null },
    { name: "Zapier integration (demo)", lastUsed: hoursAgo(50), revoked: null },
    { name: "Old PMS sync — rotated (demo)", lastUsed: hoursAgo(800), revoked: hoursAgo(720) },
  ];
  let n = 0;
  for (const t of tokens) {
    const { error } = await supabase.from("api_tokens").insert({
      property_id: PROPERTY_ID,
      name: t.name,
      token_hash: mint(),
      created_by: owner,
      created_at: hoursAgo(900),
      last_used_at: t.lastUsed,
      revoked_at: t.revoked,
    });
    if (error) {
      console.error(`✗ api_token: ${error.message}`);
      process.exit(1);
    }
    n++;
  }
  console.log(`✅ api_tokens (${n}, incl. 1 revoked)`);
}

console.log("\nDone.");
