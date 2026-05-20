import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { requireUser } from "@/lib/auth/session";
import { getServerQueryClient } from "@/lib/query/server";
import { searchMentions } from "@/lib/stream/server";

/**
 * Inbox section layout — server-prefetches the mention search into the
 * shared React Query cache so a hard load of `/inbox` arrives populated.
 * The actual rendering surface (`<InboxSurface>`) lives one level up in
 * the property layout so the chat sidebar's Inbox link can `pushState`
 * here from anywhere under the chat section.
 *
 * `inbox/page.tsx` is `null`; rendering is owned by the property-layout
 * surface.
 */
export default async function InboxLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const user = await requireUser();

  const queryClient = getServerQueryClient();
  void queryClient.prefetchQuery({
    queryKey: ["mentions", propertyId, user.id],
    queryFn: () => searchMentions(propertyId, user.id),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
