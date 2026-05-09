import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TaskRoom } from "@/components/tasks/task-room";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string; taskId: string }>;
}) {
  const { propertyId, taskId } = await params;
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, assignee_id, due_at, created_at, updated_at",
    )
    .eq("property_id", propertyId)
    .eq("id", taskId)
    .maybeSingle();

  if (!task) notFound();

  return (
    <TaskRoom
      propertyId={propertyId}
      task={{
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assigneeId: task.assignee_id,
        dueAt: task.due_at,
      }}
    />
  );
}
