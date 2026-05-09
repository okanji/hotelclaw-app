"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Hash, Plus } from "lucide-react";
import { useState } from "react";
import { CreateChannelDialog } from "./create-channel-dialog";

type Channel = {
  id: string;
  stream_channel_id: string;
  name: string;
  is_private: boolean;
};

export function ChannelSidebarList({ propertyId }: { propertyId: string }) {
  const params = useParams<{ channelId?: string }>();
  const activeChannelId = params?.channelId;
  const [open, setOpen] = useState(false);

  const { data: channels = [], isLoading } = useQuery<Channel[]>({
    queryKey: ["channels", propertyId],
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/channels`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load channels");
      return res.json();
    },
  });

  return (
    <>
      <SidebarMenu>
        {isLoading ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
        ) : channels.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No channels yet.
          </div>
        ) : (
          channels.map((c) => (
            <SidebarMenuItem key={c.id}>
              <SidebarMenuButton
                render={
                  <Link href={`/p/${propertyId}/chat/${c.stream_channel_id}`} />
                }
                isActive={c.stream_channel_id === activeChannelId}
                tooltip={c.name}
              >
                <Hash />
                <span>{c.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))
        )}
        <SidebarMenuItem>
          <SidebarMenuButton onClick={() => setOpen(true)} tooltip="New channel">
            <Plus />
            <span>New channel</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <CreateChannelDialog
        propertyId={propertyId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
