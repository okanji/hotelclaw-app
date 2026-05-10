"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import type { Membership } from "@/lib/auth/session";

export function PropertySwitcher({
  currentPropertyId,
  memberships,
}: {
  currentPropertyId: string;
  memberships: Membership[];
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const current = memberships.find((m) => m.property_id === currentPropertyId);
  const canInvite = current?.role === "owner" || current?.role === "manager";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="size-4" />
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
