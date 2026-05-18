import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { DocumentEditor } from "@/components/documents/document-editor";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ propertyId: string; documentId: string }>;
}) {
  const { propertyId, documentId } = await params;
  await requireUser();

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, parent_id, archived_at, property_id")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc || doc.archived_at || doc.property_id !== propertyId) {
    notFound();
  }

  // Ancestor chain for the breadcrumb. A property's document set is small,
  // so we fetch it flat and walk parent links in memory instead of issuing a
  // recursive query. The `seen` guard makes a corrupt cycle terminate.
  const { data: tree } = await supabase
    .from("documents")
    .select("id, title, parent_id")
    .eq("property_id", propertyId)
    .is("archived_at", null);

  const byId = new Map((tree ?? []).map((row) => [row.id, row]));
  const ancestors: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  let cursor = doc.parent_id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    ancestors.unshift({ id: node.id, title: node.title });
    cursor = node.parent_id;
  }

  return (
    <DocumentEditor
      propertyId={propertyId}
      documentId={documentId}
      initialTitle={doc.title}
      ancestors={ancestors}
    />
  );
}
