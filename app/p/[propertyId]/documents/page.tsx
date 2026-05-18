import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import { getDocuments } from "@/lib/documents/queries";
import { DocumentList } from "@/components/documents/document-list";

export default async function DocumentsIndexPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  await requireUser();

  // Stream the document list to the client instead of awaiting it here, so
  // the route transition isn't blocked on the DB query — <DocumentList>'s
  // `useQuery(["documents", propertyId])` hydrates from the streamed result.
  const queryClient = getServerQueryClient();
  const supabase = await createClient();
  void queryClient.prefetchQuery({
    queryKey: ["documents", propertyId],
    queryFn: () => getDocuments(supabase, propertyId),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DocumentList propertyId={propertyId} />
    </HydrationBoundary>
  );
}
