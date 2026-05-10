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
import { Check, ChevronDown, Copy } from "lucide-react";
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

export function InviteDialog({ propertyId, open, onOpenChange }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createInvite({ propertyId, email, role });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // If server returned a relative URL (NEXT_PUBLIC_SITE_URL not set),
      // absolutize it client-side.
      const url = result.url.startsWith("http")
        ? result.url
        : `${window.location.origin}${result.url}`;
      setLink(url);
      toast.success("Invite link ready");
    });
  }

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      toast.success("Copied to clipboard");
    });
  }

  function reset() {
    setEmail("");
    setRole("staff");
    setLink(null);
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
          <DialogTitle>Invite to property</DialogTitle>
          <DialogDescription>
            Generates a one-time link valid for 7 days. Send it via email or
            chat — anyone signed in with this link will join.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <Label>Invite link</Label>
            <div className="flex gap-2">
              <Input value={link} readOnly className="flex-1 font-mono text-xs" />
              <Button type="button" onClick={copy} variant="outline">
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For <span className="font-medium">{email}</span> · role{" "}
              <span className="font-medium">{role}</span>
            </p>
          </div>
        ) : (
          <form onSubmit={generate} className="space-y-4">
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
                {pending ? "Generating…" : "Generate link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
