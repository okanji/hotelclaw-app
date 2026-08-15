// RLS verification for the pod tenancy spine (spec M1 acceptance).
// Proves: (1) an authenticated user who is NOT a member of a client's
// properties cannot read that client's rows (clients/bots/bot_chat_sessions);
// (2) a member of one of the client's properties CAN. Uses a temporary
// membership that is removed afterwards.
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/verify-tenancy-rls.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const CLIENT_SLUG = "oamar-portfolio";

// The test principal is an EPHEMERAL auth user created per run (and deleted
// in the finally). An earlier version borrowed the demo owner and assumed it
// had no pod memberships — that premise silently broke the day the demo user
// was added to a pod property, producing false "outsider can read" failures.

async function userClientByEmail(email) {
  const { data: link, error: lErr } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (lErr) throw lErr;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: vErr } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (vErr) throw vErr;
  return client;
}

function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const { data: pod } = await service
    .from("clients").select("id").eq("slug", CLIENT_SLUG).single();
  const { data: watamu } = await service
    .from("properties").select("id").eq("slug", "watamu-villa").single();

  const email = `rls-probe-${Date.now().toString(36)}@villa.dev`;
  const { data: created, error: cErr } = await service.auth.admin.createUser({
    email, email_confirm: true,
  });
  if (cErr) throw cErr;
  const probeId = created.user.id;

  try {
    const asUser = await userClientByEmail(email);

    // 1. Outsider: no membership in any pod property -> sees nothing.
    const c1 = await asUser.from("clients").select("id").eq("id", pod.id);
    assert("outsider cannot read clients row", (c1.data ?? []).length === 0);
    const b1 = await asUser.from("bots").select("id").eq("client_id", pod.id);
    assert("outsider cannot read bots", (b1.data ?? []).length === 0);
    const s1 = await asUser.from("bot_chat_sessions").select("id").eq("client_id", pod.id);
    assert("outsider cannot read bot_chat_sessions", (s1.data ?? []).length === 0);

    // 2. Membership in one pod property -> can read.
    await service.from("memberships").insert({
      property_id: watamu.id, user_id: probeId, role: "manager",
    });
    const c2 = await asUser.from("clients").select("id").eq("id", pod.id);
    assert("member can read clients row", (c2.data ?? []).length === 1);
    const b2 = await asUser.from("bots").select("id").eq("client_id", pod.id);
    assert("member can read bots", (b2.data ?? []).length === 4);

    // 3. Members still cannot WRITE the tenancy spine (no write policies).
    const w = await asUser.from("bots").update({ display_name: "hax" })
      .eq("client_id", pod.id).select("id");
    assert("member cannot write bots", (w.data ?? []).length === 0);
  } finally {
    // Membership rows cascade with the auth user.
    await service.from("memberships").delete().eq("user_id", probeId);
    await service.auth.admin.deleteUser(probeId);
  }

  console.log(process.exitCode ? "RLS VERIFICATION FAILED" : "RLS verification passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
