import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";

/**
 * QueryClient config shared by the browser provider (`QueryProvider`) and
 * server-side prefetch (`getServerQueryClient`) so the two never drift.
 *
 * `shouldDehydrateQuery` is widened to also dehydrate still-`pending` queries:
 * that lets a Server Component kick off a query *without awaiting it* and
 * stream the result down to the client. The route transition therefore isn't
 * blocked on the fetch — the page renders immediately and `useQuery` resolves
 * as the streamed data lands. See `lib/query/server.ts`.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  });
}
