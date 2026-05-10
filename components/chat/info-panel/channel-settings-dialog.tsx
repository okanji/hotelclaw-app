"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useChannelStateContext } from "stream-chat-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { renameChannel, deleteChannel } from "./actions";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Channel admin dialog. Only shown to owners/managers — gated by the caller
 * (see About tab). Currently supports rename and delete; archive and
 * privacy-toggle are deferred.
 */
export function ChannelSettingsDialog({
  propertyId,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const { channel } = useChannelStateContext();
  const data = channel.data as
    | { name?: string; is_private?: boolean }
    | undefined;

  const [name, setName] = useState(data?.name ?? channel.id ?? "");
  const [busy, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === data?.name) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const result = await renameChannel({
        propertyId,
        streamChannelId: channel.id ?? "",
        name: trimmed,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Channel renamed");
      onOpenChange(false);
      router.refresh();
    });
  }

  function destroy() {
    startTransition(async () => {
      const result = await deleteChannel({
        propertyId,
        streamChannelId: channel.id ?? "",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Channel deleted");
      onOpenChange(false);
      router.push(`/p/${propertyId}/chat`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Channel settings</DialogTitle>
          <DialogDescription>
            Rename or delete this channel. Members will see the change in
            real time.
          </DialogDescription>
        </DialogHeader>

        {confirmingDelete ? (
          <div className="space-y-4">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">
                Delete #{data?.name ?? channel.id}?
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This removes the channel for every member and erases its
                message history. There's no undo.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                Keep channel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={destroy}
                disabled={busy}
              >
                {busy ? "Deleting…" : "Delete forever"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channel-name">Name</Label>
              <Input
                id="channel-name"
                autoFocus
                required
                pattern="[a-z0-9\-]+"
                title="lowercase letters, numbers, and dashes only"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and dashes only.
              </p>
            </div>
            <DialogFooter className="justify-between gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Delete channel
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
