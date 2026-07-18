import "server-only";

/**
 * Secret-store indirection for pod brain credentials (spec M1). Rows store a
 * REFERENCE (`clients.brain_token_ref` = an env var name), never the token.
 * v1 secret store is the deployment environment; swapping to a managed
 * secret manager later only changes this function.
 *
 * Refs are constrained to BRAIN_TOKEN_* so a poisoned row can't exfiltrate
 * arbitrary env vars (e.g. SUPABASE_SERVICE_ROLE_KEY) through this path.
 */
export function resolveBrainToken(tokenRef: string): string | null {
  if (!/^BRAIN_TOKEN_[A-Z0-9_]+$/.test(tokenRef)) return null;
  return process.env[tokenRef] ?? null;
}
