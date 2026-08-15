import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectDetail } from "@/components/assistant/project-detail";
import type { AssistantChat, AssistantProject } from "@/lib/assistant/types";

/**
 * A project's home: its composer, its conversations, and the context rail.
 * RLS makes "not yours" and "doesn't exist" the same 404, which is the right
 * answer for a personal surface.
 */
export default async function AssistantProjectPage({
  params,
}: {
  params: Promise<{ propertyId: string; projectId: string }>;
}) {
  const { propertyId, projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("assistant_projects")
    .select(
      "id, name, description, instructions, memory, emoji, tint, pinned, updated_at, created_at",
    )
    .eq("id", projectId)
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .maybeSingle();
  if (!project) notFound();

  // The property's zone is the sensible default for a new schedule — a brief
  // due "Monday at 8" means 8am where the hotel is, not where the server is.
  const { data: property } = await supabase
    .from("properties")
    .select("timezone")
    .eq("id", propertyId)
    .maybeSingle();

  const { data: chats } = await supabase
    .from("assistant_chats")
    .select(
      "id, title, project_id, eve_session_id, continuation_token, pinned, source, workflow_id, last_message_at, created_at",
    )
    .eq("project_id", projectId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(50);

  return (
    <ProjectDetail
      propertyId={propertyId}
      project={project as AssistantProject}
      chats={(chats ?? []) as AssistantChat[]}
      timezone={property?.timezone ?? "UTC"}
    />
  );
}
