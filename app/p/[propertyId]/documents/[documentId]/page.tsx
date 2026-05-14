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
    .select("id, title, archived_at, property_id")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc || doc.archived_at || doc.property_id !== propertyId) {
    notFound();
  }

  return (
    <DocumentEditor
      propertyId={propertyId}
      documentId={documentId}
      initialTitle={doc.title}
    />
  );
}
