import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import { getTriageQueue } from "@/lib/tasks/triage-queue";
import { RouteGate } from "@/components/gr8r/route-gate";
import { TriageView } from "@/components/triage/triage-view";

/**
 * Triage — the pending-intake queue (migration 0111), part of Tasks the way
 * Linear does it: each team's sidebar node has a Triage row
 * (`/triage?team=<id>`), the Tasks board shows "N in triage", and bare
 * `/triage` is every team at once. `?issue=` selects a row (`?task=` is the
 * older spelling — kept for old links; the task drawer skips /triage).
 * Server-rendered: the queue is prefetched into `["triage", propertyId]` so
 * the first frame is populated, then Realtime keeps it live.
 */
export default async function TriagePage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ issue?: string; task?: string; team?: string }>;
}) {
  const { propertyId } = await params;
  const { issue, task, team } = await searchParams;
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
      <RouteGate segment="triage">
        <TriageView
          propertyId={propertyId}
          initialTaskId={issue ?? task ?? null}
          initialTeamId={team ?? null}
        />
      </RouteGate>
    </HydrationBoundary>
  );
}
