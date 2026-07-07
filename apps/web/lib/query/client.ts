import { QueryClient } from "@tanstack/react-query";

/**
 * QueryClient config shared by the browser provider (`QueryProvider`) and
 * server-side prefetch (`getServerQueryClient`) so the two never drift.
 *
 * We deliberately use React Query's default `shouldDehydrateQuery` — it
 * dehydrates only `success` (and `error`) queries, never `pending`. Earlier
 * we widened it to dehydrate pending queries too, so a layout could
 * `void queryClient.prefetchQuery(...)` and stream the result. That pattern
 * only works when the prefetched promise is tracked by the React render tree
 * (`<Suspense>` / `useSuspenseQuery`); with a bare `void` prefetch the
 * promise is orphaned, the client hydrates `pending` with no in-flight
 * fetch to resolve it, and `useQuery` hangs forever. Server layouts now
 * `await` their prefetches instead.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}
