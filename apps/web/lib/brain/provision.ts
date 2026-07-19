import "server-only";
/**
 * Auto-provision a property's binding on the SHARED gbrain server at
 * creation time. Registers a per-property source + source-fenced OAuth
 * client by driving the gbrain CLI, then stores the encrypted credential
 * in property_brains — the same two commands as
 * scripts/provision-property-brain.mjs (KEEP THE COMMAND SHAPES IN SYNC;
 * the script stays the manual/backfill path and the reconciliation sweep).
 *
 * Only active where the app and the brain home share a host (dev): gated
 * on GBRAIN_HOME + BRAIN_MCP_URL. On Vercel neither the CLI nor the home
 * exists, so this returns { skipped } in microseconds and properties stay
 * brainless until the sweep runs on the brain host.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { encryptBrainSecret } from "@/lib/brain/crypto";

const execFileAsync = promisify(execFile);

export type ProvisionResult =
  | { ok: true; source: string; clientId: string }
  | { skipped: string }
  | { error: string };

async function gbrain(args: string[]): Promise<string> {
  const bin = process.env.GBRAIN_BIN ?? "gbrain";
  // The gbrain binary is a bun script — its directory (~/.bun/bin, which
  // also holds `bun`) must be on PATH for the shebang to resolve.
  const binDir = bin.includes("/") ? bin.slice(0, bin.lastIndexOf("/")) : null;
  const { stdout } = await execFileAsync(bin, args, {
    env: {
      ...process.env,
      ...(binDir ? { PATH: `${binDir}:${process.env.PATH ?? ""}` } : {}),
    },
    timeout: 60_000,
  });
  return stdout;
}

/** Never throws — a provisioning failure degrades to a brainless property. */
export async function provisionPropertyBrain(
  propertyId: string,
  slug: string,
): Promise<ProvisionResult> {
  if (!process.env.GBRAIN_HOME || !process.env.BRAIN_MCP_URL) {
    return { skipped: "gbrain provisioning not configured on this host" };
  }

  try {
    const service = createServiceClient();

    const { data: existing } = await service
      .from("property_brains")
      .select("property_id")
      .eq("property_id", propertyId)
      .maybeSingle();
    if (existing) return { skipped: "already provisioned" };

    // Pod properties inherit their client's binding — never provision them.
    const { data: property } = await service
      .from("properties")
      .select("client_id")
      .eq("id", propertyId)
      .maybeSingle();
    if (property?.client_id) return { skipped: "pod property inherits its client's binding" };

    const source = `prop-${propertyId.slice(0, 8)}`;

    try {
      await gbrain(["sources", "add", source]);
    } catch (e) {
      const out = `${(e as { stdout?: string; message?: string }).stdout ?? ""}${(e as Error).message ?? ""}`;
      if (!out.includes("exists")) throw e;
    }

    // OAuth client fenced to the source (write there, read only there).
    // The client NAME is cosmetic — on a stale-name collision (a previous
    // run died before the DB upsert), retry once with a random suffix.
    const register = (name: string) =>
      gbrain([
        "auth", "register-client", name,
        "--grant-types", "client_credentials",
        "--scopes", "read write",
        "--source", source,
        "--federated-read", source,
      ]);
    let registered: string;
    try {
      registered = await register(`prop-${slug}`);
    } catch (e) {
      const out = `${(e as { stdout?: string; message?: string }).stdout ?? ""}${(e as Error).message ?? ""}`;
      if (!out.includes("exists")) throw e;
      registered = await register(`prop-${slug}-${randomBytes(2).toString("hex")}`);
    }

    const clientId = registered.match(/gbrain_cl_[a-f0-9]+/)?.[0];
    const clientSecret = registered.match(/gbrain_cs_[a-f0-9]+/)?.[0];
    if (!clientId || !clientSecret) {
      throw new Error("could not parse client credentials from register-client output");
    }

    const { error } = await service.from("property_brains").upsert({
      property_id: propertyId,
      source,
      client_id: clientId,
      client_secret_enc: encryptBrainSecret(clientSecret),
    });
    if (error) throw new Error(error.message);

    return { ok: true, source, clientId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[provision-brain]", propertyId, message);
    return { error: message };
  }
}
