import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolvePropertyBrain } from "@/lib/brain/client";
import { AgentDetail } from "@/components/agents/agent-detail";
import type { AgentRow } from "@/lib/agents/schema";

/**
 * Agent detail — the transparent editor (instructions, model, tool grants,
 * skills, resources) beside a live chat panel talking to the eve runtime.
 */
export default async function AgentPage({
  params,
}: {
  params: Promise<{ propertyId: string; agentId: string }>;
}) {
  const { propertyId, agentId } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("id, property_id, name, config, status, created_by, archived_at, created_at, updated_at")
    .eq("id", agentId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!agent || agent.archived_at) notFound();

  // Documents for the resource picker (id + title is all the editor needs).
  const { data: documents } = await supabase
    .from("documents")
    .select("id, title")
    .eq("property_id", propertyId)
    .order("updated_at", { ascending: false })
    .limit(200);

  // The caller's most recent conversation with this agent, for resume.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: lastSession } = user
    ? await supabase
        .from("agent_sessions")
        .select("id, continuation_token, title")
        .eq("agent_id", agentId)
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // Brain binding presence for the resolved-config transparency panel —
  // resolved server-side, only the source NAME reaches the client.
  const brainBinding = await resolvePropertyBrain(propertyId);

  return (
    <AgentDetail
      agent={agent as unknown as AgentRow}
      brain={{
        configured: Boolean(brainBinding),
        source: brainBinding?.source ?? null,
      }}
      documents={documents ?? []}
      initialSession={
        lastSession
          ? {
              id: lastSession.id,
              continuationToken: lastSession.continuation_token,
              title: lastSession.title,
            }
          : null
      }
    />
  );
}
