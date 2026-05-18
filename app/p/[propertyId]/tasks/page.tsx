import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { TasksBoardRoom } from "@/components/tasks/board-room";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import { getTasks } from "@/lib/tasks/queries";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const user = await requireUser();

  // Stream the task list to the client instead of awaiting it here, so the
  // route transition stays instant — <TasksBoard>'s
  // `useQuery(["tasks", propertyId])` hydrates from the streamed result.
  const queryClient = getServerQueryClient();
  const supabase = await createClient();
  void queryClient.prefetchQuery({
    queryKey: ["tasks", propertyId],
    queryFn: () => getTasks(supabase, propertyId),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TasksBoardRoom propertyId={propertyId} currentUserId={user.id} />
    </HydrationBoundary>
  );
}
