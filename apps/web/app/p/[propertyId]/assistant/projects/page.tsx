import { createClient } from "@/lib/supabase/server";
import { ProjectsList } from "@/components/assistant/projects-list";
import type { AssistantProject } from "@/lib/assistant/types";

/** Every project this user has in the property, with its conversation count. */
export default async function AssistantProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { propertyId } = await params;
  const { new: openNew } = await searchParams;
  const supabase = await createClient();

  const [{ data: projects }, { data: chats }] = await Promise.all([
    supabase
      .from("assistant_projects")
      .select(
        "id, name, description, instructions, memory, emoji, tint, pinned, updated_at, created_at",
      )
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("assistant_chats")
      .select("project_id")
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .not("project_id", "is", null),
  ]);

  const chatCounts: Record<string, number> = {};
  for (const row of chats ?? []) {
    if (row.project_id) {
      chatCounts[row.project_id] = (chatCounts[row.project_id] ?? 0) + 1;
    }
  }

  return (
    <ProjectsList
      propertyId={propertyId}
      initialProjects={(projects ?? []) as AssistantProject[]}
      chatCounts={chatCounts}
      openNew={openNew === "1"}
    />
  );
}
