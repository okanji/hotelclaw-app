import "server-only";
/**
 * API-token mint/verify for the MCP endpoint. Plaintext format
 * `hc_<48 hex chars>`; only the SHA-256 hash is stored, so a DB read can
 * never leak a usable credential. Verification binds the token to its
 * property — that binding IS the tenant isolation for /api/mcp.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";

export function mintToken(): { token: string; hash: string } {
  const token = `hc_${randomBytes(24).toString("hex")}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type VerifiedToken = {
  tokenId: string;
  propertyId: string;
};

export async function verifyApiToken(
  token: string | undefined | null,
): Promise<VerifiedToken | null> {
  if (!token || !token.startsWith("hc_")) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("api_tokens")
    .select("id, property_id, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  // Best-effort usage stamp — never blocks the request.
  void supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);
  return { tokenId: data.id, propertyId: data.property_id };
}
