import { requireUser } from "@/lib/auth/session";
import { DocumentEditor } from "@/components/documents/document-editor";

/**
 * Trivial RSC — the route transition isn't blocked on any fetch. <DocumentEditor>
 * derives the doc's title + breadcrumb ancestors (and the 404 check) from the
 * shared `["documents-tree", propertyId]` cache, warm from the rail prefetch.
 */
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ propertyId: string; documentId: string }>;
}) {
  const { propertyId, documentId } = await params;
  await requireUser();

  return <DocumentEditor propertyId={propertyId} documentId={documentId} />;
}
