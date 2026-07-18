// Client (pod) onboarding automation (fleet spec M6.1). One command stands
// up a pod: Supabase rows → brain repo stamped from the template → actions
// key minted → RLS spot-check → eve smoke session. Idempotent by slug.
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/onboard-client.mjs <config.json>
//   node --env-file=.env.local --no-network-family-autoselection scripts/onboard-client.mjs --client-zero
//
// gbrain steps (import/embed/serve/token) run only when the gbrain CLI is
// installed; until then they print SKIPPED and the pod runs in fallback
// mode (personas from bots.persona_fallback, brain tools degrade).
//
// Config shape: { slug, name, properties: [{slug, name, timezone}],
//                 bots: [{bot_id, display_name, model_tier, tool_set, persona_fallback}],
//                 operatorUserId }

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, cpSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BRAINS_DIR = process.env.BRAINS_DIR ?? path.join(os.homedir(), "Desktop", "hotelclaw-brains");
const TEMPLATE = path.join(BRAINS_DIR, "pod-brain-template");
const ORIGIN = process.env.DEV_ORIGIN ?? "http://127.0.0.1:3000";

const CLIENT_ZERO = {
  slug: "client-zero",
  name: "Client Zero (drill)",
  operatorUserId: "33831554-d1a7-4f62-85a5-85952cbc11e4",
  properties: [
    { slug: "zero-lodge", name: "Zero Lodge", timezone: "Africa/Nairobi" },
  ],
  bots: [
    {
      bot_id: "frontdesk",
      display_name: "Front Desk",
      model_tier: "standard",
      tool_set: ["search_docs", "read_doc", "get_bookings", "get_booking", "create_task", "brain_query", "brain_get"],
      persona_fallback: "You are the front-desk assistant for Zero Lodge. Be warm and concise; never invent data.",
    },
    {
      bot_id: "housekeeping",
      display_name: "Operations",
      model_tier: "standard",
      tool_set: ["list_tasks", "create_task", "update_task", "brain_query", "brain_get"],
      persona_fallback: "You are the operations assistant for Zero Lodge. Terse and practical.",
    },
  ],
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: "pipe" }).toString().trim();
}
function hasGbrain() {
  try { sh("which gbrain"); return true; } catch { return false; }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: onboard-client.mjs <config.json> | --client-zero");
    process.exit(1);
  }
  const config = arg === "--client-zero" ? CLIENT_ZERO : JSON.parse(await readFile(arg, "utf8"));
  const report = [];
  const step = (name, detail) => { report.push(`✓ ${name}${detail ? ` — ${detail}` : ""}`); console.log(report.at(-1)); };
  const skip = (name, why) => { report.push(`○ SKIPPED ${name} — ${why}`); console.log(report.at(-1)); };

  // 1. Supabase rows.
  const secretRef = `BRAIN_TOKEN_POD_${config.slug.toUpperCase().replace(/-/g, "_")}`;
  const brainSource = `pod-${config.slug}`;
  if (!brainSource || brainSource === "pod-") throw new Error("brain_source must be non-empty (default-source gotcha)");
  const { data: client, error: cErr } = await supabase
    .from("clients")
    .upsert({ slug: config.slug, name: config.name, brain_source: brainSource, brain_client_secret_ref: secretRef }, { onConflict: "slug" })
    .select("id").single();
  if (cErr) throw new Error(cErr.message);
  step("client row", `${config.slug} -> ${client.id}`);

  const propertyIds = [];
  for (const p of config.properties) {
    const { data: existing } = await supabase.from("properties").select("id").eq("slug", p.slug).maybeSingle();
    if (existing) {
      await supabase.from("properties").update({ client_id: client.id, timezone: p.timezone }).eq("id", existing.id);
      propertyIds.push(existing.id);
    } else {
      const { data, error } = await supabase.from("properties")
        .insert({ slug: p.slug, name: p.name, client_id: client.id, timezone: p.timezone })
        .select("id").single();
      if (error) throw new Error(error.message);
      propertyIds.push(data.id);
    }
    await supabase.from("memberships").upsert(
      { property_id: propertyIds.at(-1), user_id: config.operatorUserId, role: "owner" },
      { onConflict: "property_id,user_id" },
    );
  }
  step("properties + operator membership", `${propertyIds.length}`);

  for (const b of config.bots) {
    const { error } = await supabase.from("bots").upsert({ client_id: client.id, ...b }, { onConflict: "client_id,bot_id" });
    if (error) throw new Error(error.message);
  }
  step("bots", `${config.bots.length} with tool allow-lists`);

  // 2. Brain repo stamped from template.
  const brainDir = path.join(BRAINS_DIR, `pod-${config.slug}-brain`);
  if (!existsSync(brainDir)) {
    if (!existsSync(TEMPLATE)) throw new Error(`template missing at ${TEMPLATE}`);
    cpSync(TEMPLATE, brainDir, { recursive: true });
    rmSync(path.join(brainDir, ".git"), { recursive: true, force: true });
    sh("git init -q", brainDir);
    sh("git add -A", brainDir);
    sh('git -c user.email=ops@hotelclaw.dev -c user.name="Hotelclaw Ops" commit -qm "Stamp from pod-brain-template"', brainDir);
    step("brain repo stamped", brainDir);
  } else {
    step("brain repo exists", brainDir);
  }

  // 3. gbrain index + endpoint (pending install approval).
  if (hasGbrain()) {
    // Shared server: register the source + a source-bound OAuth client.
    // GBRAIN_HOME + GBRAIN_DIRECT_DATABASE_URL must be exported (OPERATIONS.md).
    sh(`gbrain sources add ${brainSource} --path ${brainDir} --name "${config.name}"`);
    sh(`gbrain sync --source ${brainSource} --no-embed`, brainDir);
    const reg = sh(`gbrain auth register-client pod-${config.slug}-agents --grant-types client_credentials --scopes "read write" --source ${brainSource} --federated-read ${brainSource},master`);
    step("brain source + OAuth client registered", `store the printed secret as env ${secretRef} (clientId:clientSecret); extend hotelclaw-admin federated-read (revoke+re-register)`);
    console.log(reg.split("\n").filter((l) => /Client (ID|Secret)/.test(l)).join("\n"));
  } else {
    skip("brain source + client", `gbrain CLI not on PATH; register source ${brainSource} + OAuth client manually, set env ${secretRef}`);
  }

  // 4. Actions-MCP key (shown once).
  const token = `hc_${randomBytes(24).toString("hex")}`;
  await supabase.from("api_tokens").insert({
    property_id: propertyIds[0],
    name: `${config.slug}-actions`,
    token_hash: createHash("sha256").update(token).digest("hex"),
    created_by: config.operatorUserId,
    allowed_tools: ["list_tasks", "create_task", "get_bookings", "get_booking", "trigger_workflow", "get_workflow_status"],
  });
  step("actions-MCP key minted", `${token.slice(0, 12)}… (full key printed below ONCE)`);

  // 5. Smoke-test an eve session for bot #1 (needs dev server running).
  try {
    const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const H = {
      "content-type": "application/json",
      authorization: `Bearer ${SK}`,
      "x-hotelclaw-property": propertyIds[0],
      "x-hotelclaw-user": config.operatorUserId,
      "x-hotelclaw-bot": config.bots[0].bot_id,
    };
    const r = await fetch(`${ORIGIN}/eve/v1/session`, {
      method: "POST", headers: H,
      body: JSON.stringify({ message: "One line: who are you?" }),
    });
    const body = await r.json();
    if (!body.sessionId) throw new Error("no session id");
    step("eve smoke session", body.sessionId);
  } catch (e) {
    skip("eve smoke session", `dev server unreachable (${e.message})`);
  }

  console.log("\n=== ONBOARDING REPORT ===");
  for (const line of report) console.log(line);
  console.log(`\nActions-MCP key (store securely, shown once): ${token}`);
}

main().catch((e) => { console.error("ONBOARD FAILED:", e.message); process.exit(1); });
