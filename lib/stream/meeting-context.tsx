"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { StreamCall, useStreamVideoClient } from "@stream-io/video-react-sdk";
import type { Call } from "@stream-io/video-react-sdk";
import { toast } from "sonner";

/**
 * Sibling to HuddleProvider, but for video meetings instead of audio-only
 * huddles. Differences worth noting:
 *
 *   • Call type is `default` (full A/V) instead of `audio_room`.
 *   • Lifecycle has a preview phase ("ringing" in Stream-speak): the user
 *     sees camera/mic preview + a Join button before any media is published.
 *     A huddle just dumps you in; a meeting gives you a chance to bail.
 *   • Transcription auto-starts on join. The host is the user who pressed
 *     "Start meeting" — captured server-side in the meeting row, so any
 *     participant calling startTranscription() is fine (Stream enforces
 *     it's the right call_type capability).
 *   • A server roundtrip happens before the call exists in Stream — we POST
 *     /api/meetings/start to mint a meeting row + call id, so the
 *     transcription_ready webhook later can resolve back to a property and
 *     channel.
 */

type MeetingStage = "idle" | "preparing" | "previewing" | "in-call";

type MeetingState = {
  stage: MeetingStage;
  call: Call | null;
  meetingId: string | null;
  /** Channel that initiated the meeting (where the summary will post). */
  channelId: string | null;
  videoReady: boolean;
  /**
   * Open the preview screen for a fresh meeting tied to the given channel.
   * Creates the meeting row + Stream call, but does NOT join yet.
   */
  start: (args: { channelId: string; title?: string }) => Promise<void>;
  /** Join the prepared call (publishes mic/cam, starts transcription). */
  join: () => Promise<void>;
  /** Leave + mark ended server-side. Discards the preview if not yet joined. */
  leave: () => Promise<void>;
};

const Ctx = createContext<MeetingState | null>(null);

export function MeetingProvider({ children }: { children: React.ReactNode }) {
  const videoClient = useStreamVideoClient();
  const [call, setCall] = useState<Call | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [stage, setStage] = useState<MeetingStage>("idle");

  // Guard against double-clicks racing the API + Stream coordinator. Cheaper
  // than disabling buttons because the user can still click again after a
  // legitimate failure.
  const inFlight = useRef(false);

  const cleanup = useCallback(() => {
    setCall(null);
    setMeetingId(null);
    setChannelId(null);
    setStage("idle");
  }, []);

  const start = useCallback<MeetingState["start"]>(
    async ({ channelId: targetChannelId, title }) => {
      if (inFlight.current) return;
      if (!videoClient) {
        toast.error("Video service not ready yet — try again in a moment.");
        return;
      }
      // If a previous meeting was left half-open (preview, never joined),
      // throw it away before starting a new one.
      if (call) {
        try {
          await call.leave();
        } catch {
          /* best-effort */
        }
        cleanup();
      }

      inFlight.current = true;
      setStage("preparing");
      try {
        const res = await fetch("/api/meetings/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: targetChannelId, title }),
        });
        if (!res.ok) {
          throw new Error(
            (await res.text()) || `start failed with ${res.status}`,
          );
        }
        const data = (await res.json()) as {
          meetingId: string;
          callId: string;
          callType: string;
        };

        const newCall = videoClient.call(data.callType, data.callId);
        // getOrCreate makes the call exist on Stream's side without
        // publishing media. Members default to the host; other participants
        // get added when they call .join().
        await newCall.getOrCreate({
          data: {
            // Auto-record / auto-transcribe live on the call type's settings
            // (see docs/meetings-setup.md). We only opt into per-call
            // overrides when something deviates from the default.
            members: videoClient.streamClient.userID
              ? [{ user_id: videoClient.streamClient.userID }]
              : undefined,
          },
        });

        setCall(newCall);
        setMeetingId(data.meetingId);
        setChannelId(targetChannelId);
        setStage("previewing");
      } catch (e) {
        console.error("meeting start failed", e);
        toast.error(
          e instanceof Error ? e.message : "Couldn't start meeting",
        );
        cleanup();
      } finally {
        inFlight.current = false;
      }
    },
    [call, cleanup, videoClient],
  );

  const join = useCallback(async () => {
    if (inFlight.current) return;
    if (!call) return;
    inFlight.current = true;
    try {
      await call.join({ create: false });
      // Try to publish; failures are non-fatal (user may have denied
      // permissions and can re-grant from the in-call controls).
      try {
        await call.microphone.enable();
      } catch {
        /* mic optional */
      }
      try {
        await call.camera.enable();
      } catch {
        /* cam optional */
      }
      // Auto-start transcription. If the call type doesn't allow client-
      // side transcription (capability denied), this rejects — swallow it
      // so the join itself still succeeds.
      try {
        await call.startTranscription();
      } catch (e) {
        console.warn("startTranscription failed (continuing without it)", e);
      }
      setStage("in-call");
    } catch (e) {
      console.error("meeting join failed", e);
      toast.error(e instanceof Error ? e.message : "Couldn't join meeting");
    } finally {
      inFlight.current = false;
    }
  }, [call]);

  const leave = useCallback(async () => {
    if (!call) return;
    const id = meetingId;
    try {
      await call.leave();
    } catch (e) {
      // Leaving an already-disconnected call is non-fatal.
      console.warn("meeting leave warning", e);
    }
    cleanup();
    // Fire-and-forget — server marks ended_at and (later) the
    // transcription_ready webhook does the heavy lifting.
    if (id) {
      void fetch(`/api/meetings/${id}/end`, { method: "POST" }).catch(() => {});
    }
  }, [call, cleanup, meetingId]);

  const value = useMemo<MeetingState>(
    () => ({
      stage,
      call,
      meetingId,
      channelId,
      videoReady: !!videoClient,
      start,
      join,
      leave,
    }),
    [stage, call, meetingId, channelId, videoClient, start, join, leave],
  );

  return (
    <Ctx.Provider value={value}>
      {call ? <StreamCall call={call}>{children}</StreamCall> : children}
    </Ctx.Provider>
  );
}

export function useMeeting(): MeetingState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMeeting must be used inside MeetingProvider");
  return v;
}
