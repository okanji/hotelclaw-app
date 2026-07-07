"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { StreamCall, useStreamVideoClient } from "@stream-io/video-react-sdk";
import type { Call } from "@stream-io/video-react-sdk";
import { toast } from "sonner";

type HuddleState = {
  /** Currently-active call, or null when not in a huddle. */
  call: Call | null;
  /** Channel id this huddle is associated with (null when not in a huddle). */
  channelId: string | null;
  /** True while a join is in flight. */
  joining: boolean;
  /** Whether the underlying video client is ready (false during initial token fetch). */
  videoReady: boolean;
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
};

const Ctx = createContext<HuddleState | null>(null);

/**
 * Holds the currently-active huddle (audio call). Mounted once at the
 * property layout so the active call persists across channel navigation. The
 * Call object is created from the video client; while a call is active the
 * children get wrapped in `<StreamCall>` so descendants can use the SDK's
 * call-state hooks (useParticipants, useMicrophoneState, etc.).
 *
 * Call id derivation: `huddle:<channel_id>` — gives every channel/DM its own
 * room while keeping the mapping stable across page loads.
 */
export function HuddleProvider({ children }: { children: React.ReactNode }) {
  const videoClient = useStreamVideoClient();
  const [call, setCall] = useState<Call | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const join = useCallback(
    async (targetChannelId: string) => {
      if (joining) return;
      if (!videoClient) {
        toast.error("Voice service not ready yet — try again in a moment.");
        return;
      }
      // If we're already in a different huddle, leave it first so users can
      // hop between channels without a second active connection.
      if (call && channelId !== targetChannelId) {
        try {
          await call.leave();
        } catch {
          // Best-effort; the new join will fail loudly if the old call
          // is still holding the socket.
        }
        setCall(null);
        setChannelId(null);
      }
      if (call && channelId === targetChannelId) return; // already joined here

      setJoining(true);
      try {
        // Stream call ids must match [a-zA-Z0-9_-]. DM channel ids look like
        // `!members-…` — strip the `!` (and any other disallowed char) so the
        // coordinator accepts the id. Mapping stays stable per channel.
        const safeId = targetChannelId.replace(/[^a-zA-Z0-9_-]/g, "_");
        // `audio_room` is the Stream built-in audio-only call type — camera
        // off by default so no video device probe runs on join. By default
        // it ships with "backstage" enabled (Clubhouse-style raise-hand),
        // which we don't want for Slack-huddles: everyone in the channel
        // should walk in and speak. We disable backstage per-join and add
        // the joiner as a call member so they come in with speaker role.
        const userId = videoClient.streamClient.userID;
        const newCall = videoClient.call("audio_room", `huddle-${safeId}`);
        await newCall.join({
          create: true,
          data: {
            members: userId ? [{ user_id: userId }] : undefined,
            settings_override: {
              backstage: { enabled: false },
            },
          },
        });
        try {
          await newCall.microphone.enable();
        } catch {
          /* user can unmute manually */
        }
        setCall(newCall);
        setChannelId(targetChannelId);
      } catch (e) {
        console.error("huddle join failed", e);
        toast.error(e instanceof Error ? e.message : "Couldn't join huddle");
      } finally {
        setJoining(false);
      }
    },
    [call, channelId, joining, videoClient],
  );

  const leave = useCallback(async () => {
    if (!call) return;
    try {
      await call.leave();
    } catch (e) {
      // Calling leave on an already-disconnected call is non-fatal.
      console.warn("huddle leave warning", e);
    } finally {
      setCall(null);
      setChannelId(null);
    }
  }, [call]);

  const value = useMemo<HuddleState>(
    () => ({
      call,
      channelId,
      joining,
      videoReady: !!videoClient,
      join,
      leave,
    }),
    [call, channelId, joining, join, leave, videoClient],
  );

  return (
    <Ctx.Provider value={value}>
      {call ? <StreamCall call={call}>{children}</StreamCall> : children}
    </Ctx.Provider>
  );
}

export function useHuddle(): HuddleState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHuddle must be used inside HuddleProvider");
  return v;
}
