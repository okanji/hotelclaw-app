"use client";

import { useChannelStateContext } from "stream-chat-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInfoPanel } from "./context";
import { MembersTab } from "./members-tab";
import { PinnedTab } from "./pinned-tab";
import { AboutTab } from "./about-tab";
import { FilesTab } from "@/components/chat/files/files-tab";

/**
 * Right-side slide-out panel — sits on top of the message list (modal-less,
 * just a non-modal sheet). Mounted inside <Channel> so all child components
 * have access to channel context.
 */
export function ChannelInfoPanel({ propertyId }: { propertyId: string }) {
  const { open, tab, setTab, close } = useInfoPanel();
  const { channel } = useChannelStateContext();

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : close())}>
      <SheetContent
        side="right"
        className="flex w-[360px] flex-col gap-0 p-0 sm:max-w-[360px]"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm">Channel info</SheetTitle>
          <SheetDescription className="sr-only">
            Members, pinned messages, and channel details.
          </SheetDescription>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(t) => setTab(t as typeof tab)}
          className="flex flex-1 flex-col gap-0"
        >
          <TabsList className="mx-4 mt-2 grid w-auto grid-cols-4">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="pinned">Pinned</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="flex-1 overflow-y-auto p-3">
            <MembersTab propertyId={propertyId} />
          </TabsContent>
          <TabsContent value="pinned" className="flex-1 overflow-y-auto p-3">
            <PinnedTab />
          </TabsContent>
          <TabsContent value="files" className="flex-1 overflow-y-auto p-3">
            <FilesTab />
          </TabsContent>
          <TabsContent value="about" className="flex-1 overflow-y-auto p-3">
            <AboutTab propertyId={propertyId} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
