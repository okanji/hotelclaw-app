"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AgentConfigZod, EMPTY_AGENT_CONFIG } from "@/lib/agents/schema";

type ActionError = { error: string };

const Uuid = z.string().uuid();
const Name = z.string().trim().min(1).max(120);

export async function createAgent(input: {
  propertyId: string;
  name: string;
  config?: unknown;
}): Promise<{ agentId: string } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const name = Name.safeParse(input.name);
  if (!pid.success) return { error: "Invalid property" };
  if (!name.success) return { error: "Agent name is required" };

  let config = EMPTY_AGENT_CONFIG;
  if (input.config) {
    const parsed = AgentConfigZod.safeParse(input.config);
    if (!parsed.success) return { error: "Invalid agent config" };
    config = parsed.data;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("agents")
    .insert({
      property_id: pid.data,
      name: name.data,
      config,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to create agent" };

  revalidatePath(`/p/${pid.data}/agents`);
  return { agentId: data.id };
}

const UpdateSchema = z.object({
  agentId: Uuid,
  patch: z.object({
    name: Name.optional(),
    config: AgentConfigZod.optional(),
    status: z.enum(["active", "paused"]).optional(),
    archived_at: z.string().nullable().optional(),
  }),
});

export async function updateAgent(input: {
  agentId: string;
  patch: {
    name?: string;
    config?: unknown;
    status?: "active" | "paused";
    archived_at?: string | null;
  };
}): Promise<{ ok: true } | ActionError> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("agents")
    .update(parsed.data.patch)
    .eq("id", parsed.data.agentId)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Agent not found" };

  revalidatePath(`/p/${data.property_id}/agents`);
  return { ok: true };
}

export async function deleteAgent(
  agentId: string,
): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(agentId);
  if (!id.success) return { error: "Invalid agent" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .delete()
    .eq("id", id.data)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Agent not found" };

  revalidatePath(`/p/${data.property_id}/agents`);
  return { ok: true };
}

/**
 * Bookkeeping for the chat surface: one row per eve session so the sidebar
 * can list and resume a user's conversations. Called after each completed
 * turn with eve's session id + the latest continuation token. RLS restricts
 * rows to their owner.
 */
export async function recordAgentSession(input: {
  sessionId: string;
  agentId: string;
  propertyId: string;
  title?: string;
  continuationToken: string | null;
}): Promise<{ ok: true } | ActionError> {
  const parsed = z
    .object({
      sessionId: z.string().min(1).max(120),
      agentId: Uuid,
      propertyId: Uuid,
      title: z.string().trim().min(1).max(140).optional(),
      continuationToken: z.string().max(500).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("agent_sessions").upsert(
    {
      id: parsed.data.sessionId,
      agent_id: parsed.data.agentId,
      property_id: parsed.data.propertyId,
      user_id: user.id,
      continuation_token: parsed.data.continuationToken,
      last_message_at: new Date().toISOString(),
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
    },
    { onConflict: "id" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}
