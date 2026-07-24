// Provision brain bindings for NON-POD properties on the SHARED gbrain
// server over HTTP: creates a per-property source, registers a
// source-fenced OAuth client (write to own source, federated read of own
// source only), and stores the encrypted credential in property_brains.
// Pod properties don't need this — they inherit their client's binding.
//
// HTTP transport (2026-07-24; the CLI path is gone): the same three serve
// calls as lib/brain/provision.ts:provisionViaHttp — KEEP THE SHAPES IN
// SYNC with that module:
//   1. sources_add           (MCP tools/call, BRAIN_TOKEN_ADMIN)
//   2. /admin/login + /admin/api/register-client   (GBRAIN_ADMIN_BOOTSTRAP_TOKEN)
//   3. /admin/api/rescope-client                    (fence to the source)
// Runs from ANY machine with the three env vars (Vercel, dev, brain host).
//
//   node --env-file=.env.local scripts/provision-property-brain.mjs <property-slug-or-id> [--force]
//   node --env-file=.env.local scripts/provision-property-brain.mjs --all
//
// --all = reconciliation sweep: provisions every non-pod property that has
// no binding yet (idempotent; new app-created properties are auto-provisioned
// at creation by lib/brain/provision.ts).

import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const URL_MCP = process.env.BRAIN_MCP_URL;
const ADMIN = process.env.BRAIN_TOKEN_ADMIN;
const BOOTSTRAP = process.env.GBRAIN_ADMIN_BOOTSTRAP_TOKEN;
if (!URL_MCP || !ADMIN || !BOOTSTRAP) {
  throw new Error("BRAIN_MCP_URL, BRAIN_TOKEN_ADMIN and GBRAIN_ADMIN_BOOTSTRAP_TOKEN are required");
}
const ORIGIN = new URL(URL_MCP).origin;

// Mirror of lib/brain/crypto.ts (context "property-brains") — keep in sync.
function encryptBrainSecret(plaintext) {
  const secret =
    process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!secret) throw new Error("CHATBOT_SESSION_SECRET or STREAM_API_SECRET required");
  const key = createHash("sha256").update(`${secret}:property-brains`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

async function adminMcpToken() {
  const sep = ADMIN.indexOf(":");
  const res = await fetch(`${ORIGIN}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: ADMIN.slice(0, sep),
      client_secret: ADMIN.slice(sep + 1),
    }),
  });
  if (!res.ok) throw new Error(`admin token exchange failed (${res.status})`);
  return (await res.json()).access_token;
}

async function mcp(bearer, name, args) {
  const res = await fetch(URL_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const dataLine = text.split("\n").reverse().find((l) => l.startsWith("data:"));
  const payload = JSON.parse(dataLine ? dataLine.slice(5) : text);
  const blocks = (payload.result?.content ?? []).map((b) => b.text ?? "").join("\n");
  return { isError: Boolean(payload.result?.isError || payload.error), text: blocks };
}

async function adminPost(path, body, cookie) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let parsed = {};
  try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed, setCookie: res.headers.get("set-cookie") };
}

async function adminSession() {
  const login = await adminPost("/admin/login", { token: BOOTSTRAP });
  const cookie = login.setCookie?.match(/gbrain_admin=[^;]+/)?.[0];
  if (login.status !== 200 || !cookie) throw new Error(`admin login failed (${login.status})`);
  return cookie;
}

async function provisionOne(property, ctx) {
  const source = `prop-${property.id.slice(0, 8)}`;

  // 1. Source (idempotent: tolerate "exists").
  const added = await mcp(ctx.bearer, "sources_add", { id: source, name: source });
  if (added.isError && !/exist/i.test(added.text)) {
    throw new Error(`sources_add failed: ${added.text.slice(0, 200)}`);
  }
  console.log(added.isError ? `source ${source} already exists` : `source ${source} created`);

  // 2. Register (name cosmetic; retry once on stale collision).
  const register = (name) =>
    adminPost(
      "/admin/api/register-client",
      { name, scopes: "read write", grantTypes: ["client_credentials"] },
      ctx.cookie,
    );
  let registered = await register(`prop-${property.slug}`);
  if (registered.status !== 200 && /exist/i.test(registered.body?.error ?? "")) {
    registered = await register(`prop-${property.slug}-${randomBytes(2).toString("hex")}`);
  }
  const { clientId, clientSecret } = registered.body ?? {};
  if (registered.status !== 200 || !clientId || !clientSecret) {
    throw new Error(`register-client failed (${registered.status}): ${registered.body?.error ?? "no credentials"}`);
  }

  // 3. Fence. On failure the client is NOT stored (a default-scoped
  // credential must never land in property_brains).
  const rescoped = await adminPost(
    "/admin/api/rescope-client",
    { clientId, sourceId: source, federatedRead: [source] },
    ctx.cookie,
  );
  if (rescoped.status !== 200) {
    throw new Error(`rescope-client failed (${rescoped.status}): ${rescoped.body?.error ?? "unknown"}`);
  }

  // 4. Store encrypted.
  const { error } = await supabase.from("property_brains").upsert({
    property_id: property.id,
    source,
    client_id: clientId,
    client_secret_enc: encryptBrainSecret(clientSecret),
  });
  if (error) throw new Error(error.message);

  console.log(`✓ property ${property.slug} bound to source ${source} (client ${clientId.slice(0, 20)}…)`);
}

async function sweepAll(ctx) {
  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, slug, client_id")
    .is("client_id", null)
    .order("created_at");
  if (error) throw new Error(error.message);

  const { data: bound } = await supabase.from("property_brains").select("property_id");
  const boundIds = new Set((bound ?? []).map((r) => r.property_id));

  let provisioned = 0, skipped = 0, failed = 0;
  for (const property of properties ?? []) {
    if (boundIds.has(property.id)) {
      console.log(`– ${property.slug} already provisioned`);
      skipped += 1;
      continue;
    }
    try {
      await provisionOne(property, ctx);
      provisioned += 1;
    } catch (e) {
      console.error(`✗ ${property.slug} FAILED: ${e.message}`);
      failed += 1;
    }
  }
  console.log(`\nsweep done: ${provisioned} provisioned, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

async function main() {
  const ref = process.argv[2];
  const force = process.argv.includes("--force");
  if (!ref) {
    console.error("usage: provision-property-brain.mjs <property-slug-or-id> [--force] | --all");
    process.exit(1);
  }

  const ctx = { bearer: await adminMcpToken(), cookie: await adminSession() };

  if (ref === "--all") {
    await sweepAll(ctx);
    return;
  }

  const byId = /^[0-9a-f-]{36}$/.test(ref);
  const { data: property } = await supabase
    .from("properties")
    .select("id, slug, client_id")
    .eq(byId ? "id" : "slug", ref)
    .single();
  if (!property) throw new Error(`no property '${ref}'`);
  if (property.client_id) {
    throw new Error("This property belongs to a pod — it inherits the pod's brain binding; no provisioning needed.");
  }

  const { data: existing } = await supabase
    .from("property_brains")
    .select("property_id")
    .eq("property_id", property.id)
    .maybeSingle();
  if (existing && !force) {
    throw new Error("Binding already exists (use --force to re-register credentials).");
  }

  await provisionOne(property, ctx);
  console.log("  Credential stored encrypted in property_brains; plaintext not persisted anywhere else.");
}

main().catch((e) => { console.error("PROVISION FAILED:", e.message); process.exit(1); });
