"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Archive, MessageSquareText, Plus, Video } from "lucide-react";
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
            <ThreadsLink propertyId={propertyId} pathname={pathname} />
            <MeetingsLink propertyId={propertyId} pathname={pathname} />
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
                  className="text-sidebar-foreground/55 [&_svg]:!size-3.5 [&_svg]:!text-sidebar-foreground/55"
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

/**
 * Threads link. `threads/page.tsx` is null and `<ThreadsSurface>` in the
 * property layout owns rendering, so clicking is a zero-roundtrip
 * `pushState` — same instant feel as a channel switch. Modifier-clicks fall
 * through so "open in new tab" still works via the underlying anchor.
 */
function ThreadsLink({
  propertyId,
  pathname,
}: {
  propertyId: string;
  pathname: string;
}) {
  const href = `/p/${propertyId}/threads`;
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    window.history.pushState(null, "", href);
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} onClick={handleClick} />}
        isActive={pathname.startsWith(href)}
        tooltip="Threads"
      >
        <MessageSquareText />
        <span>Threads</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Cross-section discovery link to the meetings index. Meetings *are* tied
 * to channels (started from the chat header), so it makes sense to also
 * surface them in the chat sidebar — not just on the dedicated rail icon.
 * Unlike Threads/Inbox, the meetings page isn't a persistent surface, so
 * this hop is a real `router.push` (Link default), not a pushState.
 */
function MeetingsLink({
  propertyId,
  pathname,
}: {
  propertyId: string;
  pathname: string;
}) {
  const href = `/p/${propertyId}/meetings`;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={pathname.startsWith(href)}
        tooltip="Meetings"
      >
        <Video />
        <span>Meetings</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
