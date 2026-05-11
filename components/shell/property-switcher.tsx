"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Building2, Check, ChevronsUpDown, Plus, UserPlus } from "lucide-react";
import { InviteDialog } from "./invite-dialog";
import {
  PendingInvitesSection,
  usePendingInvitesCount,
} from "./pending-invites-section";
import { createClient } from "@/lib/supabase/client";
import type { Membership } from "@/lib/auth/session";

export function PropertySwitcher({
  currentPropertyId,
  memberships,
  email,
}: {
  currentPropertyId: string;
  memberships: Membership[];
  email: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const current = memberships.find((m) => m.property_id === currentPropertyId);
  const canInvite = current?.role === "owner" || current?.role === "manager";
  const pendingCount = usePendingInvitesCount();

  // Realtime: push new/changed invites for this email so the badge + dropdown
  // update without polling. Emails are stored lowercased on insert
  // (lib/invites/actions.ts), so we match byte-for-byte on the lowercased
  // address. The migration 0006_invites_realtime grants the invitee SELECT
  // access; without it Realtime filters the event out.
  useEffect(() => {
    if (!email) return;
    const lowered = email.toLowerCase();
    const supabase = createClient();
    const channel = supabase
      .channel(`invites:${lowered}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "invites",
          filter: `email=eq.${lowered}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["pending-invites"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [email, qc]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <div className="relative flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="size-4" />
              {pendingCount > 0 ? (
                <span
                  className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-semibold text-destructive-foreground"
                  title={`${pendingCount} pending invite${pendingCount === 1 ? "" : "s"}`}
                >
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              ) : null}
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">
                {current?.property.name ?? "Property"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {current?.role ?? ""}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            className="min-w-64"
          >
            <DropdownMenuGroup>
              <PendingInvitesSection />
              <DropdownMenuLabel>Properties</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {memberships.map((m) => (
                <DropdownMenuItem
                  key={m.property_id}
                  onClick={() => router.push(`/p/${m.property_id}/chat`)}
                  className="gap-2"
                >
                  <Building2 className="size-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{m.property.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.role}
                    </div>
                  </div>
                  {m.property_id === currentPropertyId ? (
                    <Check className="size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {canInvite ? (
                <DropdownMenuItem
                  onClick={() => setInviteOpen(true)}
                  className="gap-2"
                >
                  <UserPlus className="size-4" />
                  Invite people
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={() => router.push("/onboarding")}
                className="gap-2"
              >
                <Plus className="size-4" />
                Add property
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <InviteDialog
        propertyId={currentPropertyId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </SidebarMenu>
  );
}
