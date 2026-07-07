"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { ChannelListSection } from "@/components/chat/channel-list/channel-list-section";
import { CreateDmDialog } from "@/components/chat/dms/create-dm-dialog";

/**
 * Secondary-sidebar content for the DMs section: the direct-message channel
 * list with a create-DM control.
 */
export function DmsSection({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const [dmOpen, setDmOpen] = useState(false);

  return (
    <>
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
            propertyId={propertyId}
            userId={userId}
            channelKind="messaging"
            emptyState="No direct messages"
          />
        </SidebarGroupContent>
      </SidebarGroup>

      <CreateDmDialog
        propertyId={propertyId}
        open={dmOpen}
        onOpenChange={setDmOpen}
      />
    </>
  );
}
