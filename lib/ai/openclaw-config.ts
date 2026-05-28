import "server-only";
/**
 * Per-property OpenClaw API credentials.
 *
 * Same shape as `resolvePropertyGbrainConfig`. Target deployment is one
 * OpenClaw process per property; resolver swaps from env fallback to DB
 * row lookup when per-property provisioning is built.
 *
 * Resolution order:
 *   1. Per-property DB row (TODO: properties.openclaw_api_url/_token)
 *   2. Env fallback: OPENCLAW_API_URL + OPENCLAW_API_TOKEN
 *   3. null → `delegate_to_openclaw` falls back to the logging stub
 */

export type OpenclawConfig = { url: string; token: string | undefined };

export async function resolvePropertyOpenclawConfig(
  _propertyId: string,
): Promise<OpenclawConfig | null> {
  // (1) Per-property override — not yet provisioned.

  // (2) Env fallback.
  const url = process.env.OPENCLAW_API_URL;
  if (url) {
    return { url, token: process.env.OPENCLAW_API_TOKEN };
  }

  // (3) Not configured.
  return null;
}
