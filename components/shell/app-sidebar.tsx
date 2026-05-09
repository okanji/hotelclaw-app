"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronsUpDown, ListChecks, LogOut } from "lucide-react";
import { PropertySwitcher } from "./property-switcher";
import { ChannelSidebarList } from "@/components/chat/channel-sidebar-list";
import type { Membership } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";

type Props = {
  currentPropertyId: string;
  memberships: Membership[];
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
};

export function AppSidebar({ currentPropertyId, memberships, user }: Props) {
  const pathname = usePathname();
  const initials = (user.name ?? user.email ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <PropertySwitcher
          currentPropertyId={currentPropertyId}
          memberships={memberships}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between pr-1">
            Channels
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <ChannelSidebarList propertyId={currentPropertyId} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`/p/${currentPropertyId}/tasks`} />}
                  isActive={pathname.startsWith(`/p/${currentPropertyId}/tasks`)}
                  tooltip="Tasks"
                >
                  <ListChecks />
                  <span>Tasks</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" />}
              >
                <Avatar className="size-7">
                  <AvatarImage src={user.avatarUrl ?? undefined} />
                  <AvatarFallback>{initials || "?"}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {user.name ?? user.email}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                className="min-w-56"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {user.name ?? user.email}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      void signOut();
                    }}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
