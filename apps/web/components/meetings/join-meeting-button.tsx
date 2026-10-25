"use client";

import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMeeting } from "@/lib/stream/meeting-context";

/**
 * Join an existing meeting row's call — a live walk-up call or a scheduled
 * video meeting inside its slot. Reuses the provider's `startScheduled` (the
 * same path the calendar's event details use): the row already owns a
 * `stream_call_id`, so there is no second `/api/meetings/start` mint.
 */
export function JoinMeetingButton({
  meetingId,
  callId,
  callType,
  size = "sm",
}: {
  meetingId: string;
  callId: string;
  callType: string;
  size?: "xs" | "sm" | "default";
}) {
  const { startScheduled, videoReady, stage, meetingId: activeId } = useMeeting();
  const inThis = stage !== "idle" && activeId === meetingId;

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      disabled={!videoReady || inThis || stage === "preparing"}
      title={videoReady ? "Join the call" : "Video not ready yet"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void startScheduled({ meetingId, callId, callType });
      }}
    >
      <Video />
      {inThis ? "Joined" : "Join"}
    </Button>
  );
}
