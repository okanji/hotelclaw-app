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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronDown, Copy, Mail } from "lucide-react";
import { toast } from "sonner";
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
    setRole("staff");
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
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="text-sm">
                {success.emailSent ? (
                  <>
                    <p>
                      Invite sent to{" "}
                      <span className="font-medium">{success.email}</span> as{" "}
                      <span className="font-medium">{success.role}</span>.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      They'll get an email from{" "}
                      <code className="text-[10px]">auth@villa.dev</code>.
                      Check spam if it doesn't arrive.
                    </p>
                  </>
                ) : success.isExistingUser ? (
                  <>
                    <p>
                      {success.isResend
                        ? "Invite resent to"
                        : "Invite sent to"}{" "}
                      <span className="font-medium">{success.email}</span>{" "}
                      (existing account) as{" "}
                      <span className="font-medium">{success.role}</span>.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      They'll also see it in their in-app pending invites.
                      Email sender:{" "}
                      <code className="text-[10px]">
                        Hotelclaw &lt;noreply@villa.dev&gt;
                      </code>
                      .
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-destructive">Email failed to send.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {success.emailError ??
                        "Share the backup link below directly."}
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
            <div className="space-y-2">
              <Label>Role</Label>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button type="button" variant="outline" />}
                >
                  <span className="capitalize">{role}</span>
                  <ChevronDown className="size-4 opacity-50" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {ROLES.map((r) => (
                    <DropdownMenuItem
                      key={r.id}
                      onClick={() => setRole(r.id)}
                      className="flex items-start gap-2"
                    >
                      <Check
                        className={`mt-0.5 size-4 ${role === r.id ? "opacity-100" : "opacity-0"}`}
                      />
                      <div>
                        <div className="text-sm font-medium">{r.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.hint}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
