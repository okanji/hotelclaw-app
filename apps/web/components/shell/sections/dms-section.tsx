"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { ChannelListSection } from "@/components/chat/channel-list/channel-list-section";
import { CreateDmDialog } from "@/components/chat/dms/create-dm-dialog";

/**
 * The direct-message list in gr8r sidebar markup: a `.sgroup` with a
 * `.sgroup-h` heading whose hover-revealed `.ibtn` starts a new DM.
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
      <div className="sgroup">
        <div className="sgroup-h">
          <span>Direct messages</span>
          <span className="sp" />
          <button
            type="button"
            className="ibtn ibtn-xs"
            onClick={() => setDmOpen(true)}
            title="New direct message"
            aria-label="New direct message"
          >
            <Gi icon={Plus} size={14} />
          </button>
        </div>
        <ChannelListSection
          propertyId={propertyId}
          userId={userId}
          channelKind="messaging"
          emptyState="No direct messages"
        />
      </div>

      <CreateDmDialog
        propertyId={propertyId}
        open={dmOpen}
        onOpenChange={setDmOpen}
      />
    </>
  );
}
