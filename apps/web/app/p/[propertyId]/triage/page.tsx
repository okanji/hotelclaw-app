import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import { getTriageQueue } from "@/lib/tasks/triage-queue";
import { TriageView } from "@/components/triage/triage-view";

/**
 * Triage — the pending-intake queue (migration 0111). Server-rendered like
 * Bookings/Archive: the queue is prefetched into the shared React Query
 * cache under `["triage", propertyId]` (the key `triageQueueQueryOptions`
 * reads) so the first frame is populated; after that the client owns it and
 * Realtime keeps it live. Because this page renders through the property
 * layout's `children`, the sidebar must reach it with a real navigation, not
 * the surfaces' pushState fast path.
 */
export default async function TriagePage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ task?: string; team?: string }>;
}) {
  const { propertyId } = await params;
  const { task, team } = await searchParams;
  await requireUser();

  const queryClient = getServerQueryClient();
  const supabase = await createClient();
  // Await — dehydrate only serializes resolved queries (see lib/query/client).
  await queryClient.prefetchQuery({
    queryKey: ["triage", propertyId],
    queryFn: () => getTriageQueue(supabase, propertyId),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TriageView
        propertyId={propertyId}
        initialTaskId={task ?? null}
        initialTeamId={team ?? null}
      />
    </HydrationBoundary>
  );
}
