"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { acceptInvite } from "@/lib/invites/actions";

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
      router.push(`/p/${result.propertyId}/chat`);
    });
  }

  return (
    <Button onClick={accept} disabled={pending}>
      {pending ? "Joining…" : "Accept invite"}
    </Button>
  );
}
