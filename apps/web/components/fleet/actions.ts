"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty, getSessionUser } from "@/lib/auth/session";
import { POD_TOOL_IDS } from "@/lib/fleet/tool-catalog";
import { runPodDecisionTurn } from "@/lib/stream/pod-bot-reply";

/**
 * Fleet server actions. The fleet tables (clients/bots/bot_chat_sessions)
 * deliberately have NO member write policies — like the org chart, writes
 * run through the SERVICE client after an explicit role gate read via the
 * caller's own RLS client (components/org/actions.ts precedent). Every
 * write is additionally scoped by verifying the target row belongs to the
 * caller's property's client — never trust ids alone.
 */

type ActionError = { error: string };
const Uuid = z.string().uuid();

async function podScope(
  propertyId: string,
): Promise<{ clientId: string; role: string } | ActionError> {
  const pid = Uuid.safeParse(propertyId);
  if (!pid.success) return { error: "Invalid property" };
  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };
  const service = createServiceClient();
  const { data: property } = await service
    .from("properties")
    .select("client_id")
    .eq("id", pid.data)
    .maybeSingle();
  if (!property?.client_id) return { error: "This property has no pod" };
  return { clientId: property.client_id, role: membership.role };
}

const BotPatch = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  persona_fallback: z.string().trim().max(4000).nullable().optional(),
  tool_set: z
    .array(z.string())
    .max(30)
    .refine((ids) => ids.every((id) => POD_TOOL_IDS.has(id)), {
      message: "Unknown tool id",
    })
    .optional(),
  model_tier: z.enum(["standard", "advanced"]).optional(),
});

export async function updateBot(input: {
  propertyId: string;
  botId: string;
  patch: z.infer<typeof BotPatch>;
}): Promise<{ ok: true } | ActionError> {
  const scope = await podScope(input.propertyId);
  if ("error" in scope) return scope;
  if (scope.role !== "owner") {
    return { error: "Only owners can change pod bot configuration" };
  }
  const bid = Uuid.safeParse(input.botId);
  if (!bid.success) return { error: "Invalid bot" };
  const patch = BotPatch.safeParse(input.patch);
  if (!patch.success) {
    return { error: patch.error.issues[0]?.message ?? "Invalid changes" };
  }
  if (Object.keys(patch.data).length === 0) return { ok: true };

  const service = createServiceClient();
  // Tenancy gate: the bot must belong to THIS property's client.
  const { data: bot } = await service
    .from("bots")
    .select("id, client_id")
    .eq("id", bid.data)
    .maybeSingle();
  if (!bot || bot.client_id !== scope.clientId) return { error: "Bot not found" };

  const { error } = await service
    .from("bots")
    .update({
      ...(patch.data.display_name !== undefined
        ? { display_name: patch.data.display_name }
        : {}),
      ...(patch.data.persona_fallback !== undefined
        ? { persona_fallback: patch.data.persona_fallback || null }
        : {}),
      ...(patch.data.tool_set !== undefined ? { tool_set: patch.data.tool_set } : {}),
      ...(patch.data.model_tier !== undefined
        ? { model_tier: patch.data.model_tier }
        : {}),
    })
    .eq("id", bot.id);
  if (error) return { error: error.message };

  revalidatePath(`/p/${input.propertyId}/agents/fleet`);
  revalidatePath(`/p/${input.propertyId}/agents/fleet/${bot.id}`);
  return { ok: true };
}

export async function decideApproval(input: {
  propertyId: string;
  sessionRowId: string;
  decision: "approve" | "deny";
}): Promise<{ ok: true; outcome: string } | ActionError> {
  const scope = await podScope(input.propertyId);
  if ("error" in scope) return scope;
  if (scope.role !== "owner" && scope.role !== "manager") {
    return { error: "Only owners and managers can decide approvals" };
  }
  const rid = Uuid.safeParse(input.sessionRowId);
  if (!rid.success) return { error: "Invalid session" };
  if (input.decision !== "approve" && input.decision !== "deny") {
    return { error: "Invalid decision" };
  }

  const service = createServiceClient();
  const { data: row } = await service
    .from("bot_chat_sessions")
    .select(
      "id, client_id, property_id, bot_id, channel_id, eve_session_id, eve_continuation_token, status",
    )
    .eq("id", rid.data)
    .maybeSingle();
  // Tenancy gate: the session row must belong to THIS property.
  if (!row || row.property_id !== input.propertyId) {
    return { error: "Session not found" };
  }
  if (row.status !== "awaiting_approval") {
    return { error: "This approval is no longer pending." };
  }

  const user = await getSessionUser();
  if (!user) return { error: "Not signed in" };

  return runPodDecisionTurn({
    sessionRow: row,
    decision: input.decision,
    actorUserId: user.id,
  });
}
