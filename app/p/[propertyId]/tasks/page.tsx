import { TasksBoardRoom } from "@/components/tasks/board-room";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <TasksBoardRoom propertyId={propertyId} />;
}
