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
import { Copy, Mail } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createInvite } from "@/lib/invites/actions";
import type { Role } from "@/lib/db/types";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: "staff", label: "Staff", hint: "Can chat, create tasks" },
  { id: "manager", label: "Manager", hint: "Staff + invite + manage channels" },
  { id: "owner", label: "Owner", hint: "Full control" },
];

type SuccessState = {
  email: string;
  role: Role;
  url: string;
  emailSent: boolean;
  isExistingUser: boolean;
  isResend: boolean;
  emailError?: string;
};

export function InviteDialog({ propertyId, open, onOpenChange }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [pending, startTransition] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createInvite({ propertyId, email, role });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const url = result.url.startsWith("http")
        ? result.url
        : `${window.location.origin}${result.url}`;
      setSuccess({
        email,
        role,
        url,
        emailSent: result.emailSent,
        isExistingUser: result.isExistingUser,
        isResend: result.isResend,
        emailError: result.emailError,
      });
    });
  }

  function copy() {
    if (!success) return;
    navigator.clipboard.writeText(success.url).then(() => {
      toast.success("Copied to clipboard");
    });
  }

  function reset() {
    setEmail("");
    // Role deliberately survives "Invite another": snapping it back to staff
    // silently downgraded the next invite while the success card the inviter
    // was reading still said "as owner". Inviting a run of people to the same
    // role is also the common case.
    setSuccess(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {success?.isResend ? "Invite resent" : "Invite to property"}
          </DialogTitle>
          <DialogDescription>
            We'll email a sign-in link. Clicking it creates the account (if
            needed), signs them in, and adds them to this property.
          </DialogDescription>
        </DialogHeader>
        {success ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border bg-muted p-3">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="text-sm">
                {success.emailSent ? (
                  <>
                    <p>
                      {success.isResend
                        ? "Invite resent to"
                        : "Invite sent to"}{" "}
                      <span className="font-medium">{success.email}</span>
                      {success.isExistingUser ? " (existing account)" : ""} as{" "}
                      <span className="font-medium">{success.role}</span>.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      They'll get an email from{" "}
                      <code className="text-xs">
                        Hotelclaw &lt;noreply@villa.dev&gt;
                      </code>
                      . Check spam if it doesn't arrive.
                      {success.isExistingUser
                        ? " They'll also see it in their in-app pending invites."
                        : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-destructive">Email failed to send.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {success.emailError ??
                        "Share the backup link below directly."}
                      {success.isExistingUser
                        ? " They'll still see the invite in their in-app pending invites."
                        : ""}
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Backup invite link
              </Label>
              <div className="flex gap-2">
                <Input
                  value={success.url}
                  readOnly
                  className="flex-1 font-mono text-xs"
                />
                <Button type="button" onClick={copy} variant="outline">
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={reset}
              >
                Invite another
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                placeholder="teammate@hotel.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                autoFocus
              />
            </div>
            {/* Laid out flat rather than in a dropdown: the selected role has
                to be visible at the moment you press Enter in the email field,
                which submits the form. A collapsed picker meant people sent
                staff invites believing they'd chosen owner. */}
            <div className="space-y-2">
              <Label id="invite-role-label">Role</Label>
              <div
                role="radiogroup"
                aria-labelledby="invite-role-label"
                className="grid grid-cols-3 gap-1.5"
              >
                {ROLES.map((r) => {
                  const selected = role === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={pending}
                      onClick={() => setRole(r.id)}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 text-left transition-colors",
                        "focus-visible:shadow-focus focus-visible:outline-none",
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "block text-sm font-medium",
                          selected ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {r.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {r.hint}
                      </span>
                    </button>
                  );
                })}
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
              <Button type="submit" disabled={pending || !email}>
                {pending ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
