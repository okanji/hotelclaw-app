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
import { RailLogo } from "./rail-logo";
import { InviteDialog } from "./invite-dialog";
import { MembersDialog } from "./members-dialog";
import { InvitesDialog } from "./invites-dialog";
import { PendingInvitesSection } from "./pending-invites-section";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
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
            render={<SidebarMenuButton size="lg" className="h-9 w-fit max-w-full" />}
          >
            {/* Brand mark — a small tinted tile next to the org name (aubergine
                tile / white glyph in light, inverted in dark). */}
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#4a154b] text-white dark:bg-white dark:text-[#4a154b]">
              <RailLogo className="size-3" />
            </span>
            <span className="min-w-0 truncate text-sm font-semibold text-sidebar-accent-foreground">
              {current?.property.name ?? "Property"}
            </span>
            <ChevronsUpDown className="size-3.5! shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            sideOffset={6}
            className="min-w-72 p-1.5"
          >
            <PendingInvitesSection />

            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Properties
              </DropdownMenuLabel>
              {memberships.map((m) => {
                const isActive = m.property_id === currentPropertyId;
                const tint = tileTint(m.property_id);
                return (
                  <DropdownMenuItem
                    key={m.property_id}
                    // Switching property lands on its Home — the app's universal
                    // default surface.
                    onClick={() => router.push(`/p/${m.property_id}/home`)}
                    className={cn(
                      "gap-2.5 px-2 py-2",
                      isActive && "bg-accent/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold uppercase",
                        tint,
                      )}
                    >
                      {initial(m.property.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {m.property.name}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {m.role}
                      </div>
                    </div>
                    {isActive ? (
                      <Check className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => setMembersOpen(true)}
                className="gap-2.5 px-2 py-1.5"
              >
                <Users className="size-4 text-muted-foreground" />
                People
              </DropdownMenuItem>
              {canInvite ? (
                <>
                  <DropdownMenuItem
                    onClick={() => setInviteOpen(true)}
                    className="gap-2.5 px-2 py-1.5"
                  >
                    <UserPlus className="size-4 text-muted-foreground" />
                    Invite people
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setInvitesOpen(true)}
                    className="gap-2.5 px-2 py-1.5"
                  >
                    <MailCheck className="size-4 text-muted-foreground" />
                    Manage invites
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuItem
                onClick={() => router.push("/onboarding?add=1")}
                className="gap-2.5 px-2 py-1.5"
              >
                <Plus className="size-4 text-muted-foreground" />
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

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

// Deterministic per-property tile tint so each property reads as distinct in
// the list (the trigger keeps the single aubergine brand mark).
const TILE_TINTS = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
];

function tileTint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TILE_TINTS[h % TILE_TINTS.length];
}
