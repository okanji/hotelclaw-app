"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Archive, MessageSquareText, Plus } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ChannelListSection } from "@/components/chat/channel-list/channel-list-section";
import { CreateChannelDialog } from "@/components/chat/create-channel-dialog";
import { ArchivedChannelsDialog } from "@/components/chat/archived-channels-dialog";
import { InboxSidebarLink } from "@/components/chat/inbox/inbox-sidebar-link";
import { DmsSection } from "./dms-section";

/**
 * Secondary-sidebar content for the Chat section: Mentions + Threads quick
 * links, the direct-message list, then the team channel list with create /
 * archived controls. DMs also have their own rail section — surfacing them
 * here too mirrors Slack, where channels and DMs share one pane.
 */
export function ChatSection({
  propertyId,
  userId,
  isChannelAdmin,
}: {
  propertyId: string;
  userId: string;
  isChannelAdmin: boolean;
}) {
  const pathname = usePathname();
  const [channelOpen, setChannelOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <InboxSidebarLink propertyId={propertyId} userId={userId} />
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`/p/${propertyId}/threads`} />}
                isActive={pathname.startsWith(`/p/${propertyId}/threads`)}
                tooltip="Threads"
              >
                <MessageSquareText />
                <span>Threads</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <DmsSection propertyId={propertyId} userId={userId} />

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
            propertyId={propertyId}
            userId={userId}
            channelKind="team"
            emptyState="No channels yet"
          />
          {isChannelAdmin ? (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  onClick={() => setArchivedOpen(true)}
                  tooltip="Archived channels"
                  className="text-sidebar-foreground/55 [&_svg]:size-3.5 [&_svg]:opacity-60"
                >
                  <Archive />
                  <span>Archived</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : null}
        </SidebarGroupContent>
      </SidebarGroup>

      <CreateChannelDialog
        propertyId={propertyId}
        open={channelOpen}
        onOpenChange={setChannelOpen}
      />
      {isChannelAdmin ? (
        <ArchivedChannelsDialog
          propertyId={propertyId}
          open={archivedOpen}
          onOpenChange={setArchivedOpen}
        />
      ) : null}
    </>
  );
}
