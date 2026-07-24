import "server-only";
/**
 * Provision a property's binding on the SHARED gbrain server: register a
 * per-property source + a source-fenced OAuth client, then store the
 * encrypted credential in property_brains. Tenancy is that OAuth client
 * (write bound to its source, reads federated to its own source only).
 *
 * TWO TRANSPORTS, one behaviour:
 *   - CLI  — drives the `gbrain` binary against a local GBRAIN_HOME. Only
 *            works where the app and the brain home share a host (dev / the
 *            brain host). This is the historical path.
 *   - HTTP — drives the shared serve over MCP `tools/call` with an
 *            admin-scoped OAuth client (BRAIN_TOKEN_ADMIN). Works from
 *            anywhere the serve is reachable — including Vercel — so a
 *            property created in prod gets a brain at creation time.
 *            Requires the serve to expose the `register_client` op
 *            (source creation via `sources_add` is already remote-callable).
 *
 * Selection: CLI when GBRAIN_HOME is present (proven, and it's the brain
 * host), else HTTP when BRAIN_TOKEN_ADMIN is present, else a no-op skip.
 * Never throws — a provisioning failure degrades to a brainless property
 * (the sweep / the "Provision now" button reconcile later).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { callBrain, type BrainCredential } from "@hotelclaw/brain";
import { createServiceClient } from "@/lib/supabase/server";
import { encryptBrainSecret } from "@/lib/brain/crypto";
import { logBrainEvent } from "@/lib/brain/telemetry";

const execFileAsync = promisify(execFile);

export type ProvisionResult =
  | { ok: true; source: string; clientId: string; transport: "cli" | "http" }
  | { skipped: string }
  | { error: string };

/** Which transport this host can provision through, if any. */
export function provisionTransport(): "cli" | "http" | null {
  if (process.env.GBRAIN_HOME) return "cli";
  if (process.env.BRAIN_MCP_URL && process.env.BRAIN_TOKEN_ADMIN) return "http";
  return null;
}

/** Parse BRAIN_TOKEN_ADMIN ("gbrain_cl_…:gbrain_cs_…") into a credential. */
function adminCredential(): BrainCredential | null {
  const raw = process.env.BRAIN_TOKEN_ADMIN;
  const sep = raw?.indexOf(":") ?? -1;
  if (!raw || sep <= 0) return null;
  return { clientId: raw.slice(0, sep), clientSecret: raw.slice(sep + 1) };
}

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

/**
 * Common preamble shared by both transports: never provision a property that
 * already has a binding or belongs to a pod (pods inherit their client's
 * binding). Returns the source id to provision, or a skip reason.
 */
async function resolveTarget(
  propertyId: string,
): Promise<{ source: string } | { skipped: string }> {
  const service = createServiceClient();

  const { data: existing } = await service
    .from("property_brains")
    .select("property_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (existing) return { skipped: "already provisioned" };

  const { data: property } = await service
    .from("properties")
    .select("client_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (property?.client_id) {
    return { skipped: "pod property inherits its client's binding" };
  }

  return { source: `prop-${propertyId.slice(0, 8)}` };
}

/** Store the freshly-minted credential, encrypted. */
async function storeBinding(
  propertyId: string,
  source: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.from("property_brains").upsert({
    property_id: propertyId,
    source,
    client_id: clientId,
    client_secret_enc: encryptBrainSecret(clientSecret),
  });
  if (error) throw new Error(error.message);
}

/** CLI transport — the two `gbrain` commands, unchanged. */
async function provisionViaCli(
  propertyId: string,
  slug: string,
  source: string,
): Promise<ProvisionResult> {
  try {
    await gbrain(["sources", "add", source]);
  } catch (e) {
    const out = `${(e as { stdout?: string; message?: string }).stdout ?? ""}${(e as Error).message ?? ""}`;
    if (!out.includes("exists")) throw e;
  }

  // OAuth client fenced to the source (write there, read only there). The
  // client NAME is cosmetic — retry once with a random suffix on a stale
  // collision (a previous run that died before the DB upsert).
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

  await storeBinding(propertyId, source, clientId, clientSecret);
  return { ok: true, source, clientId, transport: "cli" };
}

/**
 * HTTP transport — the same two operations over the serve's MCP surface
 * with the admin credential:
 *   - `sources_add` (already remote-callable; over the remote plane it
 *     creates a bare source with no host path, exactly what we want)
 *   - `register_client` (mints the source-fenced OAuth client and returns
 *     its plaintext secret ONCE)
 */
async function provisionViaHttp(
  propertyId: string,
  slug: string,
  source: string,
): Promise<ProvisionResult> {
  const url = process.env.BRAIN_MCP_URL!;
  const admin = adminCredential();
  if (!admin) return { error: "BRAIN_TOKEN_ADMIN is not a clientId:secret pair" };

  // Source (idempotent: tolerate an "exists" from a previous partial run).
  const added = await callBrain(url, admin, "sources_add", {
    id: source,
    name: source,
  });
  if (!added.ok && !/exist/i.test(added.reason)) {
    return { error: `sources_add failed: ${added.reason}` };
  }

  const registerArgs = (name: string) => ({
    name,
    grant_types: ["client_credentials"],
    scopes: "read write",
    source,
    federated_read: [source],
  });
  let registered = await callBrain(url, admin, "register_client", registerArgs(`prop-${slug}`));
  if (!registered.ok && /exist/i.test(registered.reason)) {
    registered = await callBrain(
      url,
      admin,
      "register_client",
      registerArgs(`prop-${slug}-${randomBytes(2).toString("hex")}`),
    );
  }
  if (!registered.ok) {
    return { error: `register_client failed: ${registered.reason}` };
  }

  const body = registered.content as { clientId?: string; clientSecret?: string } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;
  const clientSecret = typeof body?.clientSecret === "string" ? body.clientSecret : undefined;
  if (!clientId || !clientSecret) {
    return { error: "register_client returned no credentials" };
  }

  await storeBinding(propertyId, source, clientId, clientSecret);
  return { ok: true, source, clientId, transport: "http" };
}

/** Never throws — a provisioning failure degrades to a brainless property. */
export async function provisionPropertyBrain(
  propertyId: string,
  slug: string,
): Promise<ProvisionResult> {
  const transport = provisionTransport();
  if (!transport) return { skipped: "gbrain provisioning not configured on this host" };

  try {
    const target = await resolveTarget(propertyId);
    if ("skipped" in target) return target;

    return transport === "cli"
      ? await provisionViaCli(propertyId, slug, target.source)
      : await provisionViaHttp(propertyId, slug, target.source);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logBrainEvent("provision_failed", { propertyId, message });
    return { error: message };
  }
}
