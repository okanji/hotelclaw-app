import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { InboxView } from "@/components/chat/inbox/inbox";
import { requireUser } from "@/lib/auth/session";
import { getServerQueryClient } from "@/lib/query/server";
import { searchMentions } from "@/lib/stream/server";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const user = await requireUser();

  // Stream the mentions search to the client — same key InboxView reads, so
  // the inbox renders populated without a client-side search roundtrip.
  const queryClient = getServerQueryClient();
  void queryClient.prefetchQuery({
    queryKey: ["mentions", propertyId, user.id],
    queryFn: () => searchMentions(propertyId, user.id),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InboxView propertyId={propertyId} userId={user.id} />
    </HydrationBoundary>
  );
}
