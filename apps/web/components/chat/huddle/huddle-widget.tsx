"use client";

import { useEffect, useState } from "react";
import {
  useCallStateHooks,
  type StreamVideoParticipant,
} from "@stream-io/video-react-sdk";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHuddle } from "@/lib/stream/huddle-context";

/**
 * Floating bottom-left mini-widget for the active huddle. Mounted at the
 * property layout so it persists across channel navigation. Only renders
 * something when there's an active call.
 *
 * Sits inside the `<HuddleProvider>` wrapper that mounts `<StreamCall>`, so
 * the SDK's `useCallStateHooks` work from here.
 */
export function HuddleWidget() {
  const { call, leave } = useHuddle();
  if (!call) return null;
  return <ActiveHuddleWidget onLeave={() => void leave()} />;
}

function ActiveHuddleWidget({ onLeave }: { onLeave: () => void }) {
  const { useParticipants, useMicrophoneState } = useCallStateHooks();
  const participants = useParticipants();
  const { microphone, isMute } = useMicrophoneState();

  const [toggling, setToggling] = useState(false);
  async function toggleMic() {
    if (toggling) return;
    setToggling(true);
    try {
      await microphone.toggle();
    } finally {
      setToggling(false);
    }
  }

  return (
    <aside
      role="region"
      aria-label="Active huddle"
      className="pointer-events-auto fixed bottom-4 left-[calc(var(--sidebar-width)+12px)] z-40 flex w-[280px] flex-col gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
          />
          <span className="truncate text-sm font-semibold">
            Huddle · {participants.length}{" "}
            {participants.length === 1 ? "person" : "people"}
          </span>
        </div>
      </div>

      <ParticipantsRow participants={participants} />

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant={isMute ? "destructive" : "outline"}
          size="sm"
          className="flex-1"
          onClick={toggleMic}
          disabled={toggling}
          aria-pressed={!isMute}
          aria-label={isMute ? "Unmute" : "Mute"}
        >
          {isMute ? (
            <MicOff className="size-3.5" />
          ) : (
            <Mic className="size-3.5" />
          )}
          <span>{isMute ? "Unmute" : "Mute"}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onLeave}
          aria-label="Leave huddle"
        >
          <PhoneOff className="size-3.5" />
          <span>Leave</span>
        </Button>
      </div>
    </aside>
  );
}

function ParticipantsRow({
  participants,
}: {
  participants: StreamVideoParticipant[];
}) {
  if (participants.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">Connecting voice…</p>
    );
  }
  const visible = participants.slice(0, 4);
  const overflow = participants.length - visible.length;
  return (
    <ul className="flex items-center gap-1.5">
      {visible.map((p) => (
        <li key={p.sessionId}>
          <ParticipantAvatar participant={p} />
        </li>
      ))}
      {overflow > 0 ? (
        <li className="flex size-7 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
          +{overflow}
        </li>
      ) : null}
    </ul>
  );
}

function ParticipantAvatar({
  participant,
}: {
  participant: StreamVideoParticipant;
}) {
  const [speakingPulse, setSpeakingPulse] = useState(false);
  // Stream's `isSpeaking` flips briefly on voice activity; a tiny throttle
  // smooths out flicker on rapid toggles without missing brief utterances.
  useEffect(() => {
    if (participant.isSpeaking) {
      setSpeakingPulse(true);
      const t = setTimeout(() => setSpeakingPulse(false), 250);
      return () => clearTimeout(t);
    }
  }, [participant.isSpeaking]);

  const name = participant.name || participant.userId;
  const initials = (name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={cn(
        "relative rounded-md p-px transition-colors",
        speakingPulse ? "bg-emerald-500" : "bg-transparent",
      )}
      title={name}
    >
      <Avatar className="size-7 rounded-md">
        <AvatarImage
          src={typeof participant.image === "string" ? participant.image : undefined}
          alt=""
        />
        <AvatarFallback className="rounded-md text-[10px]">
          {initials || "?"}
        </AvatarFallback>
      </Avatar>
      {participant.audioStream && !participant.isSpeaking ? null : null}
    </div>
  );
}
