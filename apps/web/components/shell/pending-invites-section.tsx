"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Mail } from "lucide-react";

type PendingInvite = {
  token: string;
  role: string;
  propertyId: string;
  propertyName: string;
  expiresAt: string;
};

/**
 * Renders the "Pending invites" section inside the property switcher
 * dropdown. Each row links straight to /invites/{token} where the user
 * accepts. Hidden entirely when there are no pending invites.
 */
export function PendingInvitesSection() {
  const { data = [] } = useQuery<PendingInvite[]>({
    queryKey: ["pending-invites"],
    queryFn: async () => {
      const r = await fetch("/api/me/pending-invites", { cache: "no-store" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  if (data.length === 0) return null;

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Mail className="size-3" />
        Pending invites
      </DropdownMenuLabel>
      {data.map((invite) => (
        <DropdownMenuItem
          key={invite.token}
          className="gap-2.5 px-2 py-2"
          render={<Link href={`/invites/${invite.token}`} />}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Mail className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {invite.propertyName}
            </div>
            <div className="text-xs text-muted-foreground capitalize">
              Invited as {invite.role}
            </div>
          </div>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}
