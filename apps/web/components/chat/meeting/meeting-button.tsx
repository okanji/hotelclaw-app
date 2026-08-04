"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, History, PhoneOff, Video } from "lucide-react";
import { useMeeting } from "@/lib/stream/meeting-context";

/**
 * Channel-header trigger for video meetings. Sibling to HuddleButton.
 * States:
 *   • In a meeting for this channel → red "Leave" (mirrors huddle UX)
 *   • Otherwise → split button:
 *       — main half "Meet" starts the meeting
 *       — chevron half opens a menu with "Past meetings"
 *
 * Disabled until the Stream Video client is connected (`videoReady`). The
 * MeetingProvider handles the multi-channel handoff: if the user is already
 * in a meeting elsewhere, the new start() leaves the old one first.
 */
export function MeetingButton({ channelId }: { channelId: string }) {
  const { stage, channelId: activeChannel, videoReady, start, leave } =
    useMeeting();
  const params = useParams<{ propertyId?: string }>();
  const propertyId = params?.propertyId;
  const isHere = stage !== "idle" && activeChannel === channelId;

  if (isHere) {
    return (
      <Button
        variant="destructive"
        size="default"
        title="Leave meeting"
        aria-label="Leave meeting"
        onClick={() => void leave()}
      >
        <PhoneOff className="size-4" />
        <span>Leave</span>
      </Button>
    );
  }

  return (
    // One warm ring around the pair — each half drops its own so the seam
    // isn't a doubled stroke (notion-spec §5).
    <div className="inline-flex items-stretch rounded-md shadow-ring">
      <Button
        variant="outline"
        size="default"
        title={videoReady ? "Start meeting" : "Video not ready"}
        aria-label="Start meeting"
        className="rounded-r-none shadow-none"
        disabled={!videoReady || stage === "preparing"}
        onClick={() => void start({ channelId })}
      >
        <Video className="size-4" />
        <span>Meet</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(triggerProps) => (
            <Button
              {...triggerProps}
              variant="outline"
              size="icon"
              aria-label="Meeting options"
              className="rounded-l-none shadow-none"
            >
              <ChevronDown className="size-3.5 text-faint-foreground" />
            </Button>
          )}
        />
        <DropdownMenuContent align="end" sideOffset={4}>
          {propertyId ? (
            <DropdownMenuItem
              render={<Link href={`/p/${propertyId}/meetings`} />}
            >
              <History className="size-3.5" />
              Past meetings
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
