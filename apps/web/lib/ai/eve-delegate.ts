import "server-only";
/**
 * Tier-1 → eve delegation (the layer OpenClaw was reserved for; eve now
 * owns the whole Tier-2 slot). Creates a durable eve session in task
 * style with the service bearer — the work outlives the delegating
 * request, survives restarts, and money-moving tools inside it still park
 * for human approval. The session is recorded in channel_bot_sessions
 * (`delegate:<sessionId>`) so it's discoverable and its subagents can
 * recover tenant scope (apps/agent tenant.ts root-session lookup).
 */
import { createServiceClient } from "@/lib/supabase/server";
import { eveOrigin, fleetServiceHeaders } from "@/lib/fleet/eve-session";

export async function delegateToEve(input: {
  propertyId: string;
  userId: string;
  brief: string;
}): Promise<
  | { ok: true; sessionId: string }
  | { ok: false; reason: string }
> {
  try {
    const response = await fetch(`${eveOrigin()}/eve/v1/session`, {
      method: "POST",
      headers: fleetServiceHeaders({
        propertyId: input.propertyId,
        userId: input.userId,
      }),
      body: JSON.stringify({ message: input.brief }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { ok: false, reason: `agent runtime returned ${response.status}` };
    }
    const body = (await response.json()) as { sessionId?: string };
    if (!body.sessionId) return { ok: false, reason: "no session id returned" };

    // Record fail-soft — the delegation itself already succeeded.
    try {
      const service = createServiceClient();
      await service.from("channel_bot_sessions").insert({
        property_id: input.propertyId,
        channel_id: `delegate:${body.sessionId}`,
        eve_session_id: body.sessionId,
        last_turn_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("[eve-delegate] session record failed", err);
    }

    return { ok: true, sessionId: body.sessionId };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "agent runtime unreachable",
    };
  }
}
