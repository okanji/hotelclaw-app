import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import { getTasks } from "@/lib/tasks/queries";

/**
 * Tasks section layout — only does the server-streamed prefetch into the
 * shared React Query cache. The actual rendering surface (`<TasksSurface>`)
 * lives one level up in the property layout so cross-section rail clicks
 * are `pushState`s; on a hard load of `/tasks` or `/tasks/[id]`, this
 * hydration runs first and the property-layout surface picks up warm data.
 *
 * Every page.tsx under this layout is `null`; rendering is owned by the
 * property-layout surface.
 */
export default async function TasksLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  await requireUser();

  const queryClient = getServerQueryClient();
  const supabase = await createClient();
  // Await — see lib/query/client: dehydrate only serializes resolved queries,
  // so a bare `void` prefetch hands the client an empty cache that
  // `useQuery` then has to refetch (or, worse with the old config, hung at
  // `pending`).
  await queryClient.prefetchQuery({
    queryKey: ["tasks", propertyId],
    queryFn: () => getTasks(supabase, propertyId),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
