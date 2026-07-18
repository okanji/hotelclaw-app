// Client (pod) offboarding (fleet spec M6.2): disable credentials, snapshot
// and hand over the brain repo, mark the client offboarded. Supabase data
// is ARCHIVED (status flip), not deleted — contractual deletion is a
// separate, deliberate operator action.
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/offboard-client.mjs <client-slug>

import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const BRAINS_DIR = process.env.BRAINS_DIR ?? path.join(os.homedir(), "Desktop", "hotelclaw-brains");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error("usage: offboard-client.mjs <client-slug>"); process.exit(1); }

  const { data: client } = await supabase.from("clients").select("id, slug").eq("slug", slug).single();
  if (!client) throw new Error(`no client '${slug}'`);

  // 1. Revoke every api key on the client's properties.
  const { data: properties } = await supabase.from("properties").select("id").eq("client_id", client.id);
  const propertyIds = (properties ?? []).map((p) => p.id);
  const { data: revoked } = await supabase
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .in("property_id", propertyIds)
    .is("revoked_at", null)
    .select("id");
  console.log(`✓ revoked ${revoked?.length ?? 0} api key(s)`);

  // 2. Client status -> offboarded (pod bots + brain resolution stop:
  //    resolvePodContext requires status='active').
  await supabase.from("clients").update({ status: "offboarded" }).eq("id", client.id);
  console.log("✓ client status -> offboarded (bots + brain access structurally off)");

  // 3. Snapshot the brain repo for handover (it's the client's knowledge).
  const brainDir = path.join(BRAINS_DIR, `pod-${slug}-brain`);
  if (existsSync(brainDir)) {
    const snapshot = path.join(BRAINS_DIR, `pod-${slug}-brain-handover-${new Date().toISOString().slice(0, 10)}.tar.gz`);
    execSync(`tar -czf "${snapshot}" -C "${BRAINS_DIR}" "pod-${slug}-brain"`);
    console.log(`✓ brain snapshot for handover: ${snapshot}`);
  } else {
    console.log("○ no brain repo found to snapshot");
  }

  console.log(`
Remaining operator steps:
  - gbrain auth revoke-client <pod client id> (see clients.brain_client_id); gbrain sources remove pod-${slug}; shrink hotelclaw-admin federated-read; delete env ${`BRAIN_TOKEN_POD_${slug.toUpperCase().replace(/-/g, "_")}`}.
  - Deliver the snapshot to the client; delete local copy per contract.
  - Contractual Supabase deletion (if agreed): a separate reviewed script run.`);
}

main().catch((e) => { console.error("OFFBOARD FAILED:", e.message); process.exit(1); });
