"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
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
import {
  Archive,
  ChevronsUpDown,
  ListChecks,
  LogOut,
  MessageSquareText,
  Plus,
  UserCog,
} from "lucide-react";
import { PropertySwitcher } from "./property-switcher";
import { ChannelListSection } from "@/components/chat/channel-list/channel-list-section";
import { CreateChannelDialog } from "@/components/chat/create-channel-dialog";
import { ArchivedChannelsDialog } from "@/components/chat/archived-channels-dialog";
import { CreateDmDialog } from "@/components/chat/dms/create-dm-dialog";
import { InboxSidebarLink } from "@/components/chat/inbox/inbox-sidebar-link";
import { BrowserNotifications } from "@/components/chat/inbox/browser-notifications";
import { NotificationsToggle } from "./notifications-toggle";
import { EditProfileDialog } from "./edit-profile-dialog";
import { SearchButton } from "./search-button";
import { NotificationsBell } from "./notifications-bell";
import { ThemeToggle } from "./theme-toggle";
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
  const [channelOpen, setChannelOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const currentRole = memberships.find(
    (m) => m.property_id === currentPropertyId,
  )?.role;
  const isChannelAdmin = currentRole === "owner" || currentRole === "manager";

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
          email={user.email}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SearchButton />
              <NotificationsBell
                userId={user.id}
                propertyId={currentPropertyId}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Channels</SidebarGroupLabel>
          <SidebarGroupAction
            onClick={() => setChannelOpen(true)}
            title="New channel"
          >
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <ChannelListSection
              propertyId={currentPropertyId}
              userId={user.id}
              channelKind="team"
              emptyState="No channels yet"
            />
            {isChannelAdmin ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setArchivedOpen(true)}
                    tooltip="Archived channels"
                  >
                    <Archive />
                    <span>Archived channels</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : null}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Direct messages</SidebarGroupLabel>
          <SidebarGroupAction
            onClick={() => setDmOpen(true)}
            title="New direct message"
          >
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <ChannelListSection
              propertyId={currentPropertyId}
              userId={user.id}
              channelKind="messaging"
              emptyState="No direct messages"
            />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <InboxSidebarLink
                propertyId={currentPropertyId}
                userId={user.id}
              />
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`/p/${currentPropertyId}/threads`} />}
                  isActive={pathname.startsWith(
                    `/p/${currentPropertyId}/threads`,
                  )}
                  tooltip="Threads"
                >
                  <MessageSquareText />
                  <span>Threads</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
                  <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                    <UserCog className="size-4" />
                    Edit profile
                  </DropdownMenuItem>
                  <ThemeToggle />
                  <NotificationsToggle />
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
      <CreateChannelDialog
        propertyId={currentPropertyId}
        open={channelOpen}
        onOpenChange={setChannelOpen}
      />
      {isChannelAdmin ? (
        <ArchivedChannelsDialog
          propertyId={currentPropertyId}
          open={archivedOpen}
          onOpenChange={setArchivedOpen}
        />
      ) : null}
      <CreateDmDialog
        propertyId={currentPropertyId}
        open={dmOpen}
        onOpenChange={setDmOpen}
      />
      <EditProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initialName={user.name}
        initialAvatarUrl={user.avatarUrl}
        email={user.email}
        userId={user.id}
      />
      <BrowserNotifications />
    </Sidebar>
  );
}
