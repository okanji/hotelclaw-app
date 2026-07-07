import { getServerQueryClient } from "@/lib/query/server";
import { createClient } from "@/lib/supabase/server";
import { getDocumentBoards } from "@/lib/documents/queries";

/**
 * Docs index landing. The list is rendered by `<DocumentsSurface>` in
 * `documents/layout.tsx` (when there's no `documentId` in the URL), so this
 * page is `null` and exists only so the `/documents` URL resolves.
 *
 * Boards are prefetched here (not in the section layout) so a hard load of
 * `/documents/[id]` does not block on `document_boards` — the editor only
 * needs the tree, which the layout already warms.
 */
export default async function DocumentsIndexPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const queryClient = getServerQueryClient();
  const supabase = await createClient();
  try {
    await queryClient.prefetchQuery({
      queryKey: ["document-boards", propertyId],
      queryFn: () => getDocumentBoards(supabase, propertyId),
    });
  } catch {
    // Boards are optional on the home dashboard — a missing migration or RLS
    // blip must not prevent the index route from resolving.
  }
  return null;
}
