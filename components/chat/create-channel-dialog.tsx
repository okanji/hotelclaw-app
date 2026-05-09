"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
import { createChannel } from "./actions";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateChannelDialog({ propertyId, open, onOpenChange }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createChannel({ propertyId, name });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`#${name} created`);
      setName("");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["channels", propertyId] });
      router.push(`/p/${propertyId}/chat/${result.streamChannelId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
          <DialogDescription>
            Channels are scoped to this property. All members get added by default.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              autoFocus
              required
              placeholder="front-desk"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
