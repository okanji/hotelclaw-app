"use client";

import { useEffect, useState, useTransition } from "react";
import { Pin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { pinFormToSpace } from "@/components/forms/share-actions";

type SpaceRow = { id: string; name: string; icon: string | null };

/**
 * "Pin to team" — pin a form on a space's overview next to its pinned
 * documents (shared 8-pin budget). Opened from the forms list / builder menus.
 */
export function PinFormDialog({
  propertyId,
  formId,
  formTitle,
  open,
  onOpenChange,
}: {
  propertyId: string;
  formId: string;
  formTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("spaces")
        .select("id, name, icon")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position");
      if (!cancelled) setSpaces((data ?? []) as SpaceRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, propertyId]);

  function pin(spaceId: string, spaceName: string) {
    startTransition(async () => {
      const result = await pinFormToSpace(spaceId, formId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Pinned to ${spaceName}`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Pin to team</DialogTitle>
          <DialogDescription>
            “{formTitle}” will appear on the team’s overview.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border p-1">
          {spaces === null ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Loading teams…</p>
          ) : spaces.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No teams yet.</p>
          ) : (
            spaces.map((s) => (
              <Button
                key={s.id}
                variant="ghost"
                className="w-full justify-start"
                disabled={busy}
                onClick={() => pin(s.id, s.name)}
              >
                <span className="w-5 text-center">{s.icon ?? <Pin className="size-3.5" />}</span>
                <span className="truncate">{s.name}</span>
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
