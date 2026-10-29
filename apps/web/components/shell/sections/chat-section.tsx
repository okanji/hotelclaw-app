"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, MessageSquareReply, Plus, Settings2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { channelCreationQueryOptions } from "@/lib/query/chat-queries";
import { Gi } from "@/components/gr8r/icon";
import { ChannelListSection } from "@/components/chat/channel-list/channel-list-section";
import { CreateChannelDialog } from "@/components/chat/create-channel-dialog";
import { ArchivedChannelsDialog } from "@/components/chat/archived-channels-dialog";
import { ChannelPolicyDialog } from "@/components/chat/channel-policy-dialog";
import { InboxSidebarLink } from "@/components/chat/inbox/inbox-sidebar-link";
import { DmsSection } from "./dms-section";

/**
 * The Chat node's children, in gr8r sidebar markup (`.sitem` rows, `.sgroup`
 * + `.sgroup-h` headings): Mentions + Replies quick links, the team channel
 * list with create / archived / settings controls, then direct messages —
 * channels and DMs share one pane, as in Slack.
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
  const threadsOn = pathname.startsWith(threadsHref);
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
      <InboxSidebarLink propertyId={propertyId} userId={userId} />
      {/* `threads/page.tsx` is null and `<ThreadsSurface>` in the property
          layout owns rendering, so a plain click is a zero-roundtrip
          `pushState`; modifier-clicks fall through. */}
      <Link
        href={threadsHref}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          window.history.pushState(null, "", threadsHref);
          window.dispatchEvent(new Event("hotelclaw:pathname"));
        }}
        className={threadsOn ? "sitem on" : "sitem"}
        title="Replies"
        aria-current={threadsOn ? "page" : undefined}
      >
        <Gi icon={MessageSquareReply} size={15} />
        <span className="trunc">Replies</span>
      </Link>

      <div className="sgroup">
        <div className="sgroup-h">
          <span>Channels</span>
          <span className="sp" />
          {canCreateChannel ? (
            <button
              type="button"
              className="ibtn ibtn-xs"
              onClick={() => setChannelOpen(true)}
              title="New channel"
              aria-label="New channel"
            >
              <Gi icon={Plus} size={14} />
            </button>
          ) : null}
        </div>
        <ChannelListSection
          propertyId={propertyId}
          userId={userId}
          channelKind="team"
          emptyState="No channels yet"
        />
        {isChannelAdmin ? (
          <>
            <button
              type="button"
              className="sitem"
              onClick={() => setArchivedOpen(true)}
              title="Archived channels"
              style={{ color: "var(--g8-text-3)" }}
            >
              <Gi icon={Archive} size={15} />
              <span className="trunc">Archived</span>
            </button>
            <button
              type="button"
              className="sitem"
              onClick={() => setSettingsOpen(true)}
              title="Channel settings"
              style={{ color: "var(--g8-text-3)" }}
            >
              <Gi icon={Settings2} size={15} />
              <span className="trunc">Settings</span>
            </button>
          </>
        ) : null}
      </div>

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
