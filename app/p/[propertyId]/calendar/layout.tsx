import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import {
  getCalendarSources,
  getConnections,
} from "@/lib/calendar/queries";

/**
 * Calendar section layout — server-prefetches the user's connections +
 * calendar-source list so the section sidebar renders populated on first
 * paint. The events query is window-keyed and runs client-side once the
 * grid mounts; prefetching every conceivable window would be wasteful, and
 * the section sidebar prefetch is the load-bearing one for the
 * "Connect Google" CTA state.
 */
export default async function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const queryClient = getServerQueryClient();
  const supabase = await createClient();

  await queryClient.prefetchQuery({
    queryKey: ["calendar-sources"],
    queryFn: async () => ({
      connections: await getConnections(supabase, user.id),
      sources: await getCalendarSources(supabase, user.id),
    }),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
