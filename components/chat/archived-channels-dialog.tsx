"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  listArchivedChannels,
  restoreChannel,
  type ArchivedChannel,
} from "@/components/chat/info-panel/actions";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ArchivedChannelsDialog({
  propertyId,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [channels, setChannels] = useState<ArchivedChannel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChannels(null);
    setLoadError(null);
    (async () => {
      const result = await listArchivedChannels({ propertyId });
      if (cancelled) return;
      if ("error" in result) {
        setLoadError(result.error);
        return;
      }
      setChannels(result.channels);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, propertyId]);

  function onRestore(streamChannelId: string) {
    setRestoringId(streamChannelId);
    startTransition(async () => {
      const result = await restoreChannel({ propertyId, streamChannelId });
      setRestoringId(null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`#${result.name} restored`);
      setChannels((prev) =>
        prev?.filter((c) => c.streamChannelId !== streamChannelId) ?? prev,
      );
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archived channels</DialogTitle>
          <DialogDescription>
            Restore a channel to bring it back into the sidebar with its
            history intact. If the name is taken, the restored channel gets a
            short suffix you can rename later.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[160px]">
          {loadError ? (
            <p className="py-6 text-center text-sm text-destructive">
              {loadError}
            </p>
          ) : channels === null ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : channels.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No archived channels.
            </p>
          ) : (
            <ScrollArea className="max-h-80 pr-3">
              <ul className="divide-y">
                {channels.map((c) => (
                  <li
                    key={c.streamChannelId}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        #{c.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Archived {formatArchivedAt(c.archivedAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onRestore(c.streamChannelId)}
                      disabled={pending}
                    >
                      {restoringId === c.streamChannelId
                        ? "Restoring…"
                        : "Restore"}
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
