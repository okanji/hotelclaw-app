"use client";

import { Video } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
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
    <button
      type="button"
      className={size === "default" ? "btn btn-secondary" : "btn btn-secondary btn-sm"}
      style={size === "xs" ? { height: 24, padding: "0 8px" } : undefined}
      disabled={!videoReady || inThis || stage === "preparing"}
      title={videoReady ? "Join the call" : "Video not ready yet"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void startScheduled({ meetingId, callId, callType });
      }}
    >
      <Gi icon={Video} size={size === "xs" ? 12 : 14} />
      {inThis ? "Joined" : "Join"}
    </button>
  );
}
