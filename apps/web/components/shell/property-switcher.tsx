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
import { Check, ChevronsUpDown, MailCheck, Plus, Users, UserPlus } from "lucide-react";
import { InviteDialog } from "./invite-dialog";
import { MembersDialog } from "./members-dialog";
import { InvitesDialog } from "./invites-dialog";
import { PendingInvitesSection } from "./pending-invites-section";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { propertyInitial, propertyTileTint } from "@/lib/shell/property-avatar";
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
  const [membersOpen, setMembersOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const current = memberships.find((m) => m.property_id === currentPropertyId);
  const canInvite = current?.role === "owner" || current?.role === "manager";

  // Realtime: push new/changed invites for this email so the badge + dropdown
  // update without polling. Emails are stored lowercased on insert
  // (lib/invites/actions.ts), so we match byte-for-byte on the lowercased
  // address. The migration 0006_invites_realtime grants the invitee SELECT
  // access; without it Realtime filters the event out.
  useEffect(() => {
    if (!email) return;
    const lowered = email.toLowerCase();
    const supabase = createClient();
    // Channel topic must be unique per mount — the switcher renders twice on
    // mobile (hidden desktop shell + drawer), and Supabase throws if a second
    // instance adds callbacks to an already-subscribed shared topic. The
    // postgres_changes FILTER (not the topic name) scopes the data.
    const channel = supabase
      .channel(`invites:${lowered}:${Math.random().toString(36).slice(2)}`)
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
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton className="h-[30px] w-fit max-w-full" />
            }
          >
            {/* Org name + chevron only — the property's logo lives in the rail
                now (RailOrgSwitcher). Weight 500 primary ink at 14px: this is
                a UI row, not a display title (notion-spec §3). */}
            <span className="min-w-0 truncate text-sm font-medium text-sidebar-accent-foreground">
              {current?.property.name ?? "Property"}
            </span>
            <ChevronsUpDown className="size-3.5! shrink-0 text-faint-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            sideOffset={6}
            className="min-w-72 p-1"
          >
            <PendingInvitesSection />

            <DropdownMenuGroup>
              {/* Section label: 12px/12px weight 500 faint, sentence case, no
                  tracking (notion-spec §3). */}
              <DropdownMenuLabel className="px-1.5 pt-1 pb-1.5 text-xs leading-3 font-medium text-faint-foreground">
                Properties
              </DropdownMenuLabel>
              {memberships.map((m) => {
                const isActive = m.property_id === currentPropertyId;
                const tint = propertyTileTint(m.property_id);
                return (
                  <DropdownMenuItem
                    key={m.property_id}
                    // Switching property lands on its Home — the app's universal
                    // default surface.
                    onClick={() => router.push(`/p/${m.property_id}/home`)}
                    // One quiet line: 20px tile, 14px name, faint role suffix.
                    className={cn("gap-2", isActive && "bg-accent")}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-medium uppercase",
                        tint,
                      )}
                    >
                      {propertyInitial(m.property.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {m.property.name}
                    </span>
                    <span className="shrink-0 text-xs text-faint-foreground capitalize">
                      {m.role}
                    </span>
                    {isActive ? (
                      <Check className="size-3.5 shrink-0 text-faint-foreground" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => setMembersOpen(true)}
                className="gap-2"
              >
                <Users className="size-4 text-faint-foreground" />
                People
              </DropdownMenuItem>
              {canInvite ? (
                <>
                  <DropdownMenuItem
                    onClick={() => setInviteOpen(true)}
                    className="gap-2"
                  >
                    <UserPlus className="size-4 text-faint-foreground" />
                    Invite people
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setInvitesOpen(true)}
                    className="gap-2"
                  >
                    <MailCheck className="size-4 text-faint-foreground" />
                    Manage invites
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuItem
                onClick={() => router.push("/onboarding?add=1")}
                className="gap-2"
              >
                <Plus className="size-4 text-faint-foreground" />
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
      <MembersDialog
        propertyId={currentPropertyId}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        canManage={current?.role === "owner"}
        currentEmail={email}
      />
      <InvitesDialog
        propertyId={currentPropertyId}
        open={invitesOpen}
        onOpenChange={setInvitesOpen}
        onInviteNew={() => setInviteOpen(true)}
      />
    </SidebarMenu>
  );
}
