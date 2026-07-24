/**
 * HTTP provisioning integration test — drives the REAL
 * provisionPropertyBrain module (not a mirror of it) against the live
 * shared serve + dev Supabase: throwaway property → provision over the
 * HTTP transport → binding row + minted credential verified working and
 * fenced → full cleanup.
 *
 * Self-skips without env. Run with:
 *   node --env-file=.env.local node_modules/.bin/vitest run lib/brain/__tests__/provision-http.integration.test.ts
 *
 * Serve-side flow shape is additionally covered by
 * scripts/brain-provision-http-test.mjs (standalone smoke).
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { createClient as createSbClient } from "@supabase/supabase-js";

const hasEnv = Boolean(
  process.env.BRAIN_MCP_URL &&
    process.env.BRAIN_TOKEN_ADMIN &&
    process.env.GBRAIN_ADMIN_BOOTSTRAP_TOKEN &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (process.env.CHATBOT_SESSION_SECRET || process.env.STREAM_API_SECRET),
);

// provision.ts reaches Supabase through @/lib/supabase/server, which
// imports next/headers (unavailable in plain node). The service client
// doesn't need cookies — swap in a plain supabase-js client.
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () =>
    createSbClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    ),
}));

describe.skipIf(!hasEnv)("provisionPropertyBrain over HTTP", () => {
  const sb = hasEnv
    ? createSbClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
    : (null as never);
  const origin = hasEnv ? new URL(process.env.BRAIN_MCP_URL!).origin : "";
  const cleanup: (() => Promise<void>)[] = [];

  afterAll(async () => {
    for (const fn of cleanup.reverse()) {
      await fn().catch(() => {});
    }
  });

  async function adminCookie(): Promise<string> {
    const res = await fetch(`${origin}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: process.env.GBRAIN_ADMIN_BOOTSTRAP_TOKEN }),
    });
    return res.headers.get("set-cookie")?.match(/gbrain_admin=[^;]+/)?.[0] ?? "";
  }

  async function adminMcp(name: string, args: Record<string, unknown>) {
    const cred = process.env.BRAIN_TOKEN_ADMIN!;
    const sep = cred.indexOf(":");
    const tok = await fetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cred.slice(0, sep),
        client_secret: cred.slice(sep + 1),
      }),
    }).then((r) => r.json());
    const res = await fetch(process.env.BRAIN_MCP_URL!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${tok.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return res.text();
  }

  it("provisions a real property end-to-end via the http transport", async () => {
    const { provisionPropertyBrain, provisionTransport } = await import(
      "@/lib/brain/provision"
    );
    const { decryptBrainSecret } = await import("@/lib/brain/crypto");

    // Dev has all three HTTP vars → HTTP must be the selected transport.
    expect(provisionTransport()).toBe("http");

    // Throwaway property (no memberships needed — provisioning is
    // property-scoped, not user-scoped).
    const slug = `provision-test-${Date.now().toString(36)}`;
    const { data: property, error } = await sb
      .from("properties")
      .insert({ name: "Provision HTTP test", slug })
      .select("id")
      .single();
    expect(error).toBeNull();
    const propertyId = property!.id as string;
    cleanup.push(async () => {
      await sb.from("property_brains").delete().eq("property_id", propertyId);
      await sb.from("properties").delete().eq("id", propertyId);
    });

    const result = await provisionPropertyBrain(propertyId, slug);
    expect(result).toMatchObject({ ok: true, transport: "http" });
    const source = (result as { source: string }).source;
    expect(source).toBe(`prop-${propertyId.slice(0, 8)}`);

    // Binding row exists and its secret decrypts to a working credential.
    const { data: row } = await sb
      .from("property_brains")
      .select("source, client_id, client_secret_enc")
      .eq("property_id", propertyId)
      .single();
    expect(row?.source).toBe(source);
    const secret = decryptBrainSecret(row!.client_secret_enc);
    expect(secret).toMatch(/^gbrain_cs_/);

    cleanup.push(async () => {
      // Rescope OFF the source before revoking (FK ON DELETE RESTRICT),
      // then remove the throwaway source.
      const cookie = await adminCookie();
      await fetch(`${origin}/admin/api/rescope-client`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          clientId: row!.client_id,
          sourceId: "default",
          federatedRead: ["default"],
        }),
      });
      await fetch(`${origin}/admin/api/revoke-client`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ clientId: row!.client_id }),
      });
      await adminMcp("sources_remove", { id: source, confirm_destructive: true });
    });

    const token = await fetch(`${origin}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: row!.client_id,
        client_secret: secret!,
      }),
    });
    expect(token.status).toBe(200);

    // Second provision is a no-op skip (idempotency).
    const again = await provisionPropertyBrain(propertyId, slug);
    expect(again).toMatchObject({ skipped: "already provisioned" });
  }, 120_000);
});
