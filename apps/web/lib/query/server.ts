import "server-only";
import { cache } from "react";
import { makeQueryClient } from "./client";

/**
 * Per-request server QueryClient for prefetching in Server Components.
 *
 * `cache()` gives exactly one instance per request, so a layout and the page
 * it wraps share a client — every `dehydrate()` of it picks up whatever each
 * of them prefetched. Pair with `<HydrationBoundary state={dehydrate(...)}>`.
 */
export const getServerQueryClient = cache(makeQueryClient);
