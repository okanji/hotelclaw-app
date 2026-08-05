"use client";

import { useEffect, useState, useTransition } from "react";
import { Hash } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { shareFormToChat } from "@/components/forms/share-actions";

type ChannelRow = { id: string; name: string };

/**
 * "Share to chat" — pick a channel, add an optional note, and post the form
 * as a fill-in-place card. Opened from the forms list / builder menus.
 */
export function ShareFormDialog({
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
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("chat_channels")
        .select("id, name")
        .eq("property_id", propertyId)
        .eq("is_private", false)
        .is("archived_at", null)
        .order("name");
      if (!cancelled) setChannels((data ?? []) as ChannelRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, propertyId]);

  function share() {
    if (!selected) return;
    startTransition(async () => {
      const result = await shareFormToChat({
        formId,
        channelId: selected,
        note: note.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Form shared to chat");
      onOpenChange(false);
      setSelected(null);
      setNote("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share to chat</DialogTitle>
          <DialogDescription>
            Post “{formTitle}” into a channel so the team can fill it in place.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md p-1 shadow-ring">
          {channels === null ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Loading channels…</p>
          ) : channels.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No channels yet.</p>
          ) : (
            channels.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                  selected === c.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent",
                )}
              >
                <Hash className="size-3.5 text-muted-foreground" />
                <span className="truncate">{c.name}</span>
              </button>
            ))
          )}
        </div>

        <Input
          placeholder="Add a note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          disabled={busy}
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={share} disabled={!selected || busy}>
            {busy ? "Sharing…" : "Share"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
