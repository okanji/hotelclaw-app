"use client";

import { useState, useTransition } from "react";
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
import { deleteAccount } from "@/lib/auth/actions";

type Props = {
  email: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Irreversible account deletion. Deliberately gated behind a type-your-email
 * confirmation so it can't be triggered by a stray click — the menu entry
 * that opens this is itself tucked away at the bottom of the user menu.
 */
export function DeleteAccountDialog({ email, open, onOpenChange }: Props) {
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  function onDelete() {
    if (!matches) return;
    startTransition(async () => {
      // On success the server action redirects and never returns; reaching
      // here with a value means it failed.
      const result = await deleteAccount();
      if (result && "error" in result) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setConfirm("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This permanently deletes your account and cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* A well, not a card: the destructive tint at 5% is the whole
              boundary — no stroke, no shadow (DESIGN.md separation ladder).
              It sits one rung below the confirm button's 10% fill. */}
          <div className="rounded-md bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive">What happens</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              <li>
                Properties you solely own are archived — remaining members
                lose access.
              </li>
              <li>You&apos;re removed from every other property.</li>
              <li>
                Your profile, notifications and avatar are permanently
                deleted.
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            {/* One text run inside the label: `Label` is a flex row, so
                loose siblings would each pick up its 8px gap. */}
            <Label htmlFor="delete-account-confirm">
              <span>
                Type <span className="font-mono text-foreground">{email}</span>{" "}
                to confirm
              </span>
            </Label>
            <Input
              id="delete-account-confirm"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={pending}
            />
          </div>
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
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={pending || !matches}
          >
            {pending ? "Deleting…" : "Delete my account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
