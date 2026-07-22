"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  acceptInvite,
  requestInviteAccess,
  switchAccountForInvite,
} from "@/lib/invites/actions";

export function AcceptButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function accept() {
    startTransition(async () => {
      const result = await acceptInvite(token);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Welcome to ${result.propertyName}`);
      router.push(`/p/${result.propertyId}/home`);
    });
  }

  return (
    <Button onClick={accept} disabled={pending}>
      {pending ? "Joining…" : "Accept invite"}
    </Button>
  );
}

/** Shown instead of Accept when the signed-in email ≠ the invited email:
 *  signs this session out and returns to the invite after re-login. */
export function SwitchAccountButton({
  token,
  invitedEmail,
}: {
  token: string;
  invitedEmail: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      onClick={() => startTransition(() => switchAccountForInvite(token))}
      disabled={pending}
      className="w-full"
    >
      <span className="truncate">
        {pending ? "Signing out…" : `Sign in as ${invitedEmail}`}
      </span>
    </Button>
  );
}

/** The escape hatch for people who can't sign in as the invited address —
 *  a mistyped or stale one. Pings the inviter with the address they do use,
 *  instead of leaving them to chase it down off-app. */
export function RequestAccessButton({
  token,
  myEmail,
}: {
  token: string;
  myEmail: string;
}) {
  const [pending, startTransition] = useTransition();
  const [asked, setAsked] = useState(false);

  function ask() {
    startTransition(async () => {
      const result = await requestInviteAccess(token);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setAsked(true);
      toast.success(
        result.notified
          ? "We let them know. They'll re-send it to you."
          : "Request noted — but no one is left to notify on this property.",
      );
    });
  }

  if (asked) {
    return (
      <p className="px-1 text-center text-xs text-muted-foreground">
        Asked them to re-send it to{" "}
        <span className="font-medium break-all text-foreground">{myEmail}</span>
        .
      </p>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={ask}
      disabled={pending}
      className="w-full"
    >
      {pending ? "Asking…" : "Ask them to send it to me instead"}
    </Button>
  );
}
