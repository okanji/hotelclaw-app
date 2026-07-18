// Seed pod #1 (oamar-portfolio): client row, its two properties, and the
// four pod bots with their tool allow-lists (spec M1). Idempotent — safe to
// re-run; it upserts by slug/bot_id and never duplicates.
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/seed-pod1.mjs
//
// brain_url stays empty until the M0 gbrain endpoints are provisioned; the
// token is NEVER stored — brain_token_ref names the env var that holds it.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const CLIENT = {
  slug: "oamar-portfolio",
  name: "Oamar Portfolio",
  // Fleet v2: shared brain server; tenancy = OAuth client bound to source.
  brain_source: "pod-oamar",
  brain_client_secret_ref: "BRAIN_TOKEN_POD_OAMAR_PORTFOLIO",
};

// Slugs must match the pod brain's properties/<slug>/ pages.
const PROPERTIES = [
  { slug: "kaya-villa-watamu", name: "Kaya Villa Watamu", timezone: "Africa/Nairobi" },
  { slug: "pinewood", name: "Pinewood", timezone: "Africa/Nairobi" },
];

// Tool allow-lists reference the authored eve tool names (spec M2).
// `housekeeping` deliberately lacks refund_booking — that absence is an
// M2 acceptance criterion.
const BOTS = [
  {
    bot_id: "frontdesk",
    display_name: "Front Desk",
    model_tier: "standard",
    tool_set: [
      "search_docs", "read_doc", "get_bookings", "get_booking",
      "create_task", "notify_channel", "brain_query", "brain_get",
    ],
    persona_fallback:
      "You are the front-desk assistant. Answer guest-facing and stay-logistics questions from the property's knowledge and live data. Be warm, concise, and never invent rates or availability — use tools or say you'll check.",
  },
  {
    bot_id: "housekeeping",
    display_name: "Operations",
    model_tier: "standard",
    tool_set: [
      "list_tasks", "create_task", "update_task", "notify_channel",
      "brain_query", "brain_get", "brain_write",
    ],
    persona_fallback:
      "You are the operations assistant covering housekeeping and maintenance. Track tasks, surface stale work, and log outcomes. Be terse and practical; escalate safety issues immediately.",
  },
  {
    bot_id: "bookings",
    display_name: "Bookings",
    model_tier: "advanced",
    tool_set: [
      "get_bookings", "get_booking", "search_docs", "read_doc",
      "notify_channel", "refund_booking", "brain_query", "brain_get",
    ],
    persona_fallback:
      "You are the bookings assistant. Handle availability, rate reasoning, and booking changes. Quote numbers only from tools or the property's rates page; refunds and rate overrides always go through approval.",
  },
  {
    bot_id: "analyst",
    display_name: "Analyst",
    model_tier: "advanced",
    tool_set: [
      "list_tasks", "get_bookings", "search_docs", "read_doc",
      "brain_query", "brain_get",
    ],
    persona_fallback:
      "You are the portfolio analyst. Read-only: synthesize tasks, bookings, and knowledge into clear assessments. Cite every figure's source; never take actions.",
  },
];

async function main() {
  // Client (upsert by slug).
  const { data: client, error: cErr } = await supabase
    .from("clients")
    .upsert(
      { slug: CLIENT.slug, name: CLIENT.name, brain_source: CLIENT.brain_source, brain_client_secret_ref: CLIENT.brain_client_secret_ref },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (cErr) throw new Error(`client upsert: ${cErr.message}`);
  console.log(`client ${CLIENT.slug} -> ${client.id}`);

  // Properties: adopt an existing row by slug if present, else insert.
  for (const p of PROPERTIES) {
    const { data: existing } = await supabase
      .from("properties").select("id, client_id").eq("slug", p.slug).maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("properties")
        .update({ client_id: client.id, timezone: p.timezone })
        .eq("id", existing.id);
      if (error) throw new Error(`property ${p.slug} update: ${error.message}`);
      console.log(`property ${p.slug} -> ${existing.id} (adopted)`);
    } else {
      const { data, error } = await supabase
        .from("properties")
        .insert({ slug: p.slug, name: p.name, client_id: client.id, timezone: p.timezone })
        .select("id").single();
      if (error) throw new Error(`property ${p.slug} insert: ${error.message}`);
      console.log(`property ${p.slug} -> ${data.id}`);
    }
  }

  // Bots (upsert by client_id + bot_id).
  for (const b of BOTS) {
    const { data, error } = await supabase
      .from("bots")
      .upsert({ client_id: client.id, ...b }, { onConflict: "client_id,bot_id" })
      .select("id").single();
    if (error) throw new Error(`bot ${b.bot_id}: ${error.message}`);
    console.log(`bot ${b.bot_id} -> ${data.id} [${b.tool_set.length} tools]`);
  }

  console.log("pod #1 seeded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
