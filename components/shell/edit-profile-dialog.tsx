"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { updateProfile } from "@/lib/auth/profile-actions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string | null;
  email: string;
};

export function EditProfileDialog({
  open,
  onOpenChange,
  initialName,
  email,
}: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialName ?? "");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFullName(initialName ?? "");
      setError(null);
    }
  }, [open, initialName]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateProfile({ fullName });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success("Profile updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>
            This is how teammates see you in chat, mentions, and the members
            list.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input
              id="profile-name"
              autoFocus
              required
              minLength={1}
              maxLength={120}
              autoComplete="name"
              placeholder="Jamie Rivera"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Email</Label>
            <p className="font-mono text-xs text-muted-foreground">{email}</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !fullName.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
