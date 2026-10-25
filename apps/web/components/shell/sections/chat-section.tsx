"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Plus, Settings2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { channelCreationQueryOptions } from "@/lib/query/chat-queries";
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
import { ChannelPolicyDialog } from "@/components/chat/channel-policy-dialog";
import { InboxSidebarLink } from "@/components/chat/inbox/inbox-sidebar-link";
import { RepliesIcon } from "@/components/shell/clickup-icons";
import { DmsSection } from "./dms-section";

/**
 * The Chat node's children: Mentions + Replies quick links, the team channel
 * list with create / archived controls, then direct messages — channels and
 * DMs share one pane, as in Slack.
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
  const threadsHref = `/p/${propertyId}/threads`;
  const [channelOpen, setChannelOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Workspace policy: staff lose the "New channel" affordance when creation
  // is restricted to management (the server action enforces it regardless).
  const { data: creationPolicy } = useQuery(
    channelCreationQueryOptions(propertyId),
  );
  const canCreateChannel =
    isChannelAdmin || (creationPolicy ?? "everyone") === "everyone";

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <InboxSidebarLink propertyId={propertyId} userId={userId} />
            <SidebarMenuItem>
              {/* `threads/page.tsx` is null and `<ThreadsSurface>` in the
                  property layout owns rendering, so a plain click is a
                  zero-roundtrip `pushState`; modifier-clicks fall through. */}
              <SidebarMenuButton
                render={
                  <Link
                    href={threadsHref}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      window.history.pushState(null, "", threadsHref);
                      window.dispatchEvent(new Event("hotelclaw:pathname"));
                    }}
                  />
                }
                isActive={pathname.startsWith(threadsHref)}
                tooltip="Replies"
              >
                <RepliesIcon />
                <span>Replies</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Channels</SidebarGroupLabel>
        {canCreateChannel ? (
          <SidebarGroupAction
            onClick={() => setChannelOpen(true)}
            title="New channel"
          >
            <Plus />
          </SidebarGroupAction>
        ) : null}
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
                  className="text-faint-foreground"
                >
                  <Archive />
                  <span>Archived</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  tooltip="Channel settings"
                  className="text-faint-foreground"
                >
                  <Settings2 />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : null}
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Channels before DMs, as in Slack — team conversation is the
          section's main body; DMs follow. */}
      <DmsSection propertyId={propertyId} userId={userId} />

      <CreateChannelDialog
        propertyId={propertyId}
        open={channelOpen}
        onOpenChange={setChannelOpen}
      />
      {isChannelAdmin ? (
        <>
          <ArchivedChannelsDialog
            propertyId={propertyId}
            open={archivedOpen}
            onOpenChange={setArchivedOpen}
          />
          <ChannelPolicyDialog
            propertyId={propertyId}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
          />
        </>
      ) : null}
    </>
  );
}
