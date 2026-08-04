"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  listArchivedDocuments,
  restoreDocument,
  type ArchivedDocument,
} from "./actions";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Restore archived documents. Mirrors `ArchivedChannelsDialog` — the docs
 * sidebar's `⋯` menu only archives, so this is the way back. The doc tree
 * picks the restored row up via its Supabase realtime subscription.
 */
export function ArchivedDocumentsDialog({
  propertyId,
  open,
  onOpenChange,
}: Props) {
  const [documents, setDocuments] = useState<ArchivedDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setDocuments(null);
      setLoadError(null);
      const result = await listArchivedDocuments(propertyId);
      if (cancelled) return;
      if ("error" in result) {
        setLoadError(result.error);
        return;
      }
      setDocuments(result.documents);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, propertyId]);

  function onRestore(doc: ArchivedDocument) {
    setRestoringId(doc.id);
    startTransition(async () => {
      const result = await restoreDocument(doc.id);
      setRestoringId(null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Restored "${doc.title}"`);
      setDocuments((prev) => prev?.filter((d) => d.id !== doc.id) ?? prev);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archived documents</DialogTitle>
          <DialogDescription>
            Restore a document to bring it back into the sidebar. Its content
            and history are kept intact while archived.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[160px]">
          {loadError ? (
            <p className="py-6 text-center text-sm text-destructive">
              {loadError}
            </p>
          ) : documents === null ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-[34px] w-full" />
              <Skeleton className="h-[34px] w-full" />
              <Skeleton className="h-[34px] w-full" />
            </div>
          ) : documents.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No archived documents.
            </p>
          ) : (
            <ScrollArea className="max-h-80 pr-3">
              <ul className="flex flex-col gap-px">
                {documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex min-h-[34px] items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      <p className="text-xs text-faint-foreground">
                        Archived {formatArchivedAt(d.archivedAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onRestore(d)}
                      disabled={pending}
                    >
                      {restoringId === d.id ? "Restoring…" : "Restore"}
                    </Button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatArchivedAt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
