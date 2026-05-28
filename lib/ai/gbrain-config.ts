import "server-only";
/**
 * Per-property gbrain MCP credentials.
 *
 * gbrain models tenants as separate **brains** (each brain is a Postgres
 * database). Our target deployment is one gbrain process per property,
 * each backed by its own database in a shared Supabase cluster.
 *
 * Until per-property provisioning is built, this resolver falls back to a
 * single env-configured gbrain instance suitable for local + staging
 * development. Once provisioning is wired up, per-property `gbrain_mcp_url`
 * + `gbrain_mcp_token` columns on `properties` will take precedence — no
 * call-site change required.
 *
 * Resolution order:
 *   1. Per-property DB row (TODO: properties.gbrain_mcp_url/_token)
 *   2. Env fallback: GBRAIN_MCP_URL + GBRAIN_MCP_TOKEN (shared dev instance)
 *   3. null → bots run without gbrain tools (fail-soft)
 */

export type GbrainConfig = { url: string; token: string | undefined };

export async function resolvePropertyGbrainConfig(
  _propertyId: string,
): Promise<GbrainConfig | null> {
  // (1) Per-property override — not yet provisioned. When the eager
  // per-property provisioning hook lands, look up the property here and
  // return its dedicated URL + token. Until then, every property shares
  // the env fallback below.

  // (2) Env fallback. Token is optional — gbrain in stdio/local dev may
  // not require one.
  const url = process.env.GBRAIN_MCP_URL;
  if (url) {
    return { url, token: process.env.GBRAIN_MCP_TOKEN };
  }

  // (3) Not configured.
  return null;
}
