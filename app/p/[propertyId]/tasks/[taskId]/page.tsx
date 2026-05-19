import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import { getTasks } from "@/lib/tasks/queries";
import { TaskRoom } from "@/components/tasks/task-room";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string; taskId: string }>;
}) {
  const { propertyId, taskId } = await params;
  await requireUser();

  // Stream the task list to the client; <TaskRoom> reads this one task out of
  // the same `["tasks", propertyId]` cache the board uses — already warm when
  // arriving from the board, so the route transition isn't blocked on a fetch.
  const queryClient = getServerQueryClient();
  const supabase = await createClient();
  void queryClient.prefetchQuery({
    queryKey: ["tasks", propertyId],
    queryFn: () => getTasks(supabase, propertyId),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TaskRoom propertyId={propertyId} taskId={taskId} />
    </HydrationBoundary>
  );
}
