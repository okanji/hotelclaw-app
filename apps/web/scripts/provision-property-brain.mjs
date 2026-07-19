// Provision brain bindings for NON-POD properties on the SHARED gbrain
// server: creates a per-property source, registers a source-fenced OAuth
// client (write to own source, federated read of own source only), and
// stores the encrypted credential in property_brains. Pod properties don't
// need this — they inherit their client's binding.
//
// Must run WHERE THE GBRAIN CLI CAN REACH THE SERVE'S HOME (the brain
// host): GBRAIN_HOME must point at the shared home (it lives in .env.local
// on the dev host). Re-runnable; refuses to overwrite an existing binding
// unless --force.
//
//   node --env-file=.env.local scripts/provision-property-brain.mjs <property-slug-or-id> [--force]
//   node --env-file=.env.local scripts/provision-property-brain.mjs --all
//
// --all = reconciliation sweep: provisions every non-pod property that has
// no binding yet (covers script-seeded properties; new app-created ones
// are auto-provisioned by lib/brain/provision.ts — KEEP THE COMMAND SHAPES
// IN SYNC with that module).

import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

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

function gbrain(args) {
  const bin = process.env.GBRAIN_BIN ?? "gbrain";
  // The gbrain binary is a bun script — its directory (~/.bun/bin, which
  // also holds `bun`) must be on PATH for the shebang to resolve.
  const binDir = bin.includes("/") ? bin.slice(0, bin.lastIndexOf("/")) : null;
  return execFileSync(bin, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...(binDir ? { PATH: `${binDir}:${process.env.PATH ?? ""}` } : {}),
    },
    timeout: 120_000,
  });
}

async function provisionOne(property) {
  const source = `prop-${property.id.slice(0, 8)}`;

  // 1. Source (idempotent-ish: adding an existing source errors; tolerate).
  try {
    console.log(gbrain(["sources", "add", source]).trim());
  } catch (e) {
    if (!String(e.stdout ?? e.message).includes("exists")) throw e;
    console.log(`source ${source} already exists`);
  }
  // Deliberately NOT federated: property knowledge stays invisible to
  // unqualified searches by other clients; this property's own client
  // reads it via its federated-read allow-list below.

  // 2. OAuth client fenced to the source (write there, read only there —
  //    app properties do NOT read the hotelclaw master playbooks). The
  //    client NAME is cosmetic; if a previous run registered it but died
  //    before the DB upsert, retry once with a random suffix.
  const register = (name) =>
    gbrain([
      "auth", "register-client", name,
      "--grant-types", "client_credentials",
      "--scopes", "read write",
      "--source", source,
      "--federated-read", source,
    ]);
  let registered;
  try {
    registered = register(`prop-${property.slug}`);
  } catch (e) {
    if (!String(e.stdout ?? e.message).includes("exists")) throw e;
    registered = register(`prop-${property.slug}-${randomBytes(2).toString("hex")}`);
  }
  const clientId = registered.match(/gbrain_cl_[a-f0-9]+/)?.[0];
  const clientSecret = registered.match(/gbrain_cs_[a-f0-9]+/)?.[0];
  if (!clientId || !clientSecret) {
    console.error(registered);
    throw new Error("could not parse client credentials from register-client output");
  }

  // 3. Store encrypted.
  const { error } = await supabase.from("property_brains").upsert({
    property_id: property.id,
    source,
    client_id: clientId,
    client_secret_enc: encryptBrainSecret(clientSecret),
  });
  if (error) throw new Error(error.message);

  console.log(`✓ property ${property.slug} bound to source ${source} (client ${clientId.slice(0, 20)}…)`);
}

async function sweepAll() {
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
      await provisionOne(property);
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
  if (!process.env.GBRAIN_HOME) throw new Error("GBRAIN_HOME must point at the shared brain home");

  if (ref === "--all") {
    await sweepAll();
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

  await provisionOne(property);
  console.log("  Credential stored encrypted in property_brains; plaintext not persisted anywhere else.");
}

main().catch((e) => { console.error("PROVISION FAILED:", e.message); process.exit(1); });
