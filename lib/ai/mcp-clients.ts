import "server-only";
/**
 * MCP client registry — per-property cached connections.
 *
 * gbrain isolates tenants at the **brain** (= database) level. Our target
 * deployment runs one gbrain process per property; in either the target
 * setup or the dev-time shared-instance fallback, the per-property
 * MCP client is the right unit of caching.
 *
 * Why per-property (not singleton): a singleton would route every property's
 * reads/writes through the same connection, which means the same brain in
 * the target deployment — a cross-tenant leak. Per-property clients keep
 * each tenant's connection scoped to its own brain.
 *
 * Why fail-soft: if gbrain isn't configured (env unset, no DB row yet),
 * `getGbrainClient(propertyId)` returns null. Callers that consume it
 * return an empty tool set — the bot still works, it just doesn't have
 * gbrain tools available.
 */
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { resolvePropertyGbrainConfig } from "@/lib/ai/gbrain-config";

const _gbrainClients = new Map<string, Promise<MCPClient>>();
const _warnedProperties = new Set<string>();

/**
 * Returns a connected gbrain MCP client scoped to the given property's
 * brain, or null if gbrain isn't configured for this property (resolver
 * returned null — either env-unset in dev or no per-property row yet).
 *
 * Concurrent callers for the same property share one connection promise;
 * different properties get different connections.
 */
export async function getGbrainClient(
  propertyId: string,
): Promise<MCPClient | null> {
  const cfg = await resolvePropertyGbrainConfig(propertyId);
  if (!cfg) {
    if (!_warnedProperties.has(propertyId)) {
      console.warn(
        `[mcp-clients] no gbrain config for property ${propertyId} — bots will run without gbrain tools. Set GBRAIN_MCP_URL or provision per-property config to enable.`,
      );
      _warnedProperties.add(propertyId);
    }
    return null;
  }

  let existing = _gbrainClients.get(propertyId);
  if (!existing) {
    existing = createMCPClient({
      transport: {
        type: "http",
        url: cfg.url,
        ...(cfg.token
          ? { headers: { Authorization: `Bearer ${cfg.token}` } }
          : {}),
      },
    }).catch((err) => {
      console.error(
        `[mcp-clients] failed to connect to gbrain for property ${propertyId}`,
        err,
      );
      _gbrainClients.delete(propertyId); // allow retry on next call
      throw err;
    });
    _gbrainClients.set(propertyId, existing);
  }
  try {
    return await existing;
  } catch {
    return null;
  }
}
