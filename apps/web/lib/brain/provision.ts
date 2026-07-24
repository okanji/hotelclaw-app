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
 *   - HTTP — drives the shared serve over HTTP. Works from anywhere the
 *            serve is reachable — including Vercel — so a property created
 *            in prod gets a brain at creation time. Three calls:
 *              1. `sources_add` over MCP tools/call (BRAIN_TOKEN_ADMIN, an
 *                 admin-scoped OAuth client) — creates the bare source.
 *              2. POST /admin/login with GBRAIN_ADMIN_BOOTSTRAP_TOKEN →
 *                 `gbrain_admin` session cookie (in-memory serve-side, so
 *                 login per provisioning run), then
 *                 POST /admin/api/register-client → { clientId,
 *                 clientSecret } (registered on source 'default').
 *              3. POST /admin/api/rescope-client → move the client onto
 *                 the property source + federated_read fence. Requires the
 *                 serve pinned ≥ gbrain 69bc37f7 (rescope-client landed
 *                 2026-07-24; our Railway pin tracks it — see
 *                 infra/railway-brain-serve/README.md).
 *
 * Selection: HTTP whenever BRAIN_MCP_URL + BRAIN_TOKEN_ADMIN +
 * GBRAIN_ADMIN_BOOTSTRAP_TOKEN are present (uniform across dev and prod,
 * and immune to the CLI's cross-region startup cost — gbrain 0.42.65's
 * connectEngine issues dozens of sequential config reads, >10s from a
 * ~300ms-RTT machine); CLI as the fallback where only GBRAIN_HOME exists.
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
  if (
    process.env.BRAIN_MCP_URL &&
    process.env.BRAIN_TOKEN_ADMIN &&
    process.env.GBRAIN_ADMIN_BOOTSTRAP_TOKEN
  ) {
    return "http";
  }
  if (process.env.GBRAIN_HOME) return "cli";
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

/** POST JSON to the serve's admin API; returns the parsed body or throws. */
async function adminPost<T>(
  origin: string,
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<{ status: number; body: T; setCookie: string | null }> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const setCookie = response.headers.get("set-cookie");
  let parsed: T;
  try {
    parsed = (await response.json()) as T;
  } catch {
    parsed = {} as T;
  }
  return { status: response.status, body: parsed, setCookie };
}

/**
 * HTTP transport — three calls against the shared serve:
 *   1. `sources_add` over MCP (BRAIN_TOKEN_ADMIN) — bare source, no host
 *      path (the serve rejects path/clone_dir from remote callers).
 *   2. /admin/login (bootstrap token) → cookie → /admin/api/register-client
 *      — mints the client (plaintext secret returned once, on 'default').
 *   3. /admin/api/rescope-client — fences it to the property source.
 * If rescope fails the client is NOT stored — a default-scoped credential
 * must never end up in property_brains (it could read the master source).
 */
async function provisionViaHttp(
  propertyId: string,
  slug: string,
  source: string,
): Promise<ProvisionResult> {
  const url = process.env.BRAIN_MCP_URL!;
  const bootstrapToken = process.env.GBRAIN_ADMIN_BOOTSTRAP_TOKEN!;
  const admin = adminCredential();
  if (!admin) return { error: "BRAIN_TOKEN_ADMIN is not a clientId:secret pair" };
  const origin = new URL(url).origin;

  // 1. Source (idempotent: tolerate "exists" from a previous partial run).
  const added = await callBrain(url, admin, "sources_add", {
    id: source,
    name: source,
  });
  if (!added.ok && !/exist/i.test(added.reason)) {
    return { error: `sources_add failed: ${added.reason}` };
  }

  // 2a. Admin session (in-memory serve-side; login per run, never cached).
  const login = await adminPost<{ status?: string }>(origin, "/admin/login", {
    token: bootstrapToken,
  });
  const cookie = login.setCookie?.match(/gbrain_admin=[^;]+/)?.[0];
  if (login.status !== 200 || !cookie) {
    return { error: `admin login failed (${login.status})` };
  }

  // 2b. Register. The name is cosmetic; on a stale-name collision (a prior
  // run died before the DB upsert) retry once with a random suffix.
  type Registered = { clientId?: string; clientSecret?: string; error?: string };
  const register = (name: string) =>
    adminPost<Registered>(
      origin,
      "/admin/api/register-client",
      { name, scopes: "read write", grantTypes: ["client_credentials"] },
      cookie,
    );
  let registered = await register(`prop-${slug}`);
  if (registered.status !== 200 && /exist/i.test(registered.body?.error ?? "")) {
    registered = await register(`prop-${slug}-${randomBytes(2).toString("hex")}`);
  }
  const clientId = registered.body?.clientId;
  const clientSecret = registered.body?.clientSecret;
  if (registered.status !== 200 || !clientId || !clientSecret) {
    return {
      error: `register-client failed (${registered.status}): ${registered.body?.error ?? "no credentials returned"}`,
    };
  }

  // 3. Fence to the property source. On failure, revoke-by-abandon: the
  // secret is never stored, and we surface the error for the sweep/button.
  const rescoped = await adminPost<{ error?: string }>(
    origin,
    "/admin/api/rescope-client",
    { clientId, sourceId: source, federatedRead: [source] },
    cookie,
  );
  if (rescoped.status !== 200) {
    return {
      error: `rescope-client failed (${rescoped.status}): ${rescoped.body?.error ?? "unknown"} — client ${clientId.slice(0, 20)}… left unscoped and unstored`,
    };
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
