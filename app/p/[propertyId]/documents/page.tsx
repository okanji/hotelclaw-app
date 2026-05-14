import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { createDocument } from "@/components/documents/actions";

export default async function DocumentsIndexPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  await requireUser();

  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, updated_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  async function createAndRedirect() {
    "use server";
    const res = await createDocument(propertyId);
    if ("error" in res) return;
    redirect(`/p/${propertyId}/documents/${res.id}`);
  }

  const hasDocs = (docs?.length ?? 0) > 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Collaborative notes, plans, and SOPs for this property.
          </p>
        </div>
        <form action={createAndRedirect}>
          <Button type="submit">
            <Plus className="size-4" /> New document
          </Button>
        </form>
      </header>

      {hasDocs ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {docs!.map((d) => (
            <li key={d.id}>
              <Link
                href={`/p/${propertyId}/documents/${d.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <FileText className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">
                  {d.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(d.updated_at).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center">
          <FileText className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No documents yet.</p>
          <form action={createAndRedirect}>
            <Button type="submit" variant="outline">
              <Plus className="size-4" /> Create the first one
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
