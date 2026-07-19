// Provision a brain binding for a NON-POD property on the SHARED gbrain
// server: creates a per-property source, registers a source-fenced OAuth
// client (write to own source, federated read of own source only), and
// stores the encrypted credential in property_brains. Pod properties don't
// need this — they inherit their client's binding.
//
// Must run WHERE THE GBRAIN CLI CAN REACH THE SERVE'S HOME (the brain
// host): GBRAIN_HOME must point at the shared home. Re-runnable; refuses
// to overwrite an existing binding unless --force.
//
//   GBRAIN_HOME=~/Desktop/hotelclaw-brains/.gbrain-homes/shared \
//     node --env-file=.env.local scripts/provision-property-brain.mjs <property-slug-or-id> [--force]

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
  return execFileSync("gbrain", args, {
    encoding: "utf8",
    env: { ...process.env },
    timeout: 120_000,
  });
}

async function main() {
  const ref = process.argv[2];
  const force = process.argv.includes("--force");
  if (!ref) {
    console.error("usage: provision-property-brain.mjs <property-slug-or-id> [--force]");
    process.exit(1);
  }
  if (!process.env.GBRAIN_HOME) throw new Error("GBRAIN_HOME must point at the shared brain home");

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
  //    app properties do NOT read the hotelclaw master playbooks).
  const registered = gbrain([
    "auth", "register-client", `prop-${property.slug}`,
    "--grant-types", "client_credentials",
    "--scopes", "read write",
    "--source", source,
    "--federated-read", source,
  ]);
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
  console.log("  Credential stored encrypted in property_brains; plaintext not persisted anywhere else.");
}

main().catch((e) => { console.error("PROVISION FAILED:", e.message); process.exit(1); });
