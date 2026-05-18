"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDocument } from "./actions";
import { DocumentListSkeleton } from "./document-list-skeleton";
import type { DocumentListItem } from "@/lib/documents/queries";

/**
 * Documents index. Reads the list from React Query so the page's RSC stays
 * trivial (instant route transition) and the cache survives navigation —
 * opening a doc and coming back is a cache hit, no spinner. The server
 * streams the initial list in via `<HydrationBoundary>` in `page.tsx`.
 */
export function DocumentList({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [creating, startCreate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const { data: docs, isPending } = useQuery<DocumentListItem[]>({
    queryKey: ["documents", propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/documents`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
  });

  function handleCreate() {
    setError(null);
    startCreate(async () => {
      const res = await createDocument(propertyId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.push(`/p/${propertyId}/documents/${res.id}`);
    });
  }

  // First streamed render before the hydrated list lands.
  if (isPending) return <DocumentListSkeleton />;

  const list = docs ?? [];
  const hasDocs = list.length > 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Collaborative notes, plans, and SOPs for this property.
          </p>
        </div>
        <Button type="button" onClick={handleCreate} disabled={creating}>
          <Plus className="size-4" /> New document
        </Button>
      </header>

      {error ? (
        <p className="mb-4 text-sm text-destructive">{error}</p>
      ) : null}

      {hasDocs ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((d) => (
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
          <Button
            type="button"
            variant="outline"
            onClick={handleCreate}
            disabled={creating}
          >
            <Plus className="size-4" /> Create the first one
          </Button>
        </div>
      )}
    </div>
  );
}
