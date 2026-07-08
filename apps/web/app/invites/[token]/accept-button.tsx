"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { acceptInvite, switchAccountForInvite } from "@/lib/invites/actions";

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
    >
      {pending ? "Signing out…" : `Sign in as ${invitedEmail}`}
    </Button>
  );
}
