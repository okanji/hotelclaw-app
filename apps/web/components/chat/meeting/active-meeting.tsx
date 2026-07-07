"use client";

import { useEffect } from "react";
import {
  CancelCallButton,
  PaginatedGridLayout,
  ScreenShareButton,
  SpeakerLayout,
  StreamTheme,
  ToggleAudioPreviewButton,
  ToggleAudioPublishingButton,
  ToggleVideoPreviewButton,
  ToggleVideoPublishingButton,
  VideoPreview,
  useCallStateHooks,
} from "@stream-io/video-react-sdk";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMeeting } from "@/lib/stream/meeting-context";

/**
 * Full-screen meeting overlay. Renders only when the MeetingProvider is in
 * `previewing` or `in-call`. Two sub-views:
 *
 *   • Preview — local-only camera/mic preview. Lets the user verify they
 *     look/sound right before joining. "Join meeting" calls into the
 *     provider, which publishes media + starts transcription.
 *
 *   • In-call — Stream SDK layout (speaker view + paginated grid fallback
 *     for solo / small calls), full controls, a "Transcribing" pill so
 *     people know they're being recorded.
 */
export function ActiveMeeting() {
  const { stage, leave, join } = useMeeting();
  if (stage === "idle" || stage === "preparing") return null;

  return (
    <StreamTheme
      as="div"
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Video meeting"
    >
      {stage === "previewing" ? (
        <PreviewView onJoin={() => void join()} onCancel={() => void leave()} />
      ) : (
        <InCallView onLeave={() => void leave()} />
      )}
    </StreamTheme>
  );
}

// ---------------------------------------------------------------------------
// Preview (pre-join lobby)
// ---------------------------------------------------------------------------

function PreviewView({
  onJoin,
  onCancel,
}: {
  onJoin: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold">Ready to join?</h2>
          <p className="text-sm text-white/60">
            Your meeting will be recorded and transcribed.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label="Close"
          className="text-white/70 hover:bg-white/10 hover:text-white"
        >
          <X />
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 pb-6">
        <div className="flex w-full max-w-2xl flex-col items-center gap-4">
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
            <VideoPreview />
          </div>
          <div className="flex items-center gap-2">
            <ToggleAudioPreviewButton />
            <ToggleVideoPreviewButton />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={onCancel}
              className="text-white/80 hover:bg-white/10 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={onJoin}
              className="bg-emerald-600 px-6 text-white hover:bg-emerald-500"
            >
              Join meeting
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// In-call
// ---------------------------------------------------------------------------

function InCallView({ onLeave }: { onLeave: () => void }) {
  const { useParticipantCount } = useCallStateHooks();
  const participantCount = useParticipantCount();
  // Solo / one-on-one calls feel better in a grid layout. SpeakerLayout is
  // designed for >3 participants where a single dominant speaker matters.
  const useGrid = participantCount <= 2;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-emerald-400"
            />
            Live
          </span>
          <TranscriptionPill />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onLeave}
          aria-label="Leave meeting"
          className="text-white/70 hover:bg-white/10 hover:text-white"
        >
          <X />
        </Button>
      </header>

      <div className="flex flex-1 min-h-0 items-stretch justify-center px-4 pb-4">
        <div className="flex w-full max-w-6xl">
          {useGrid ? <PaginatedGridLayout /> : <SpeakerLayout />}
        </div>
      </div>

      <footer className="flex items-center justify-center gap-2 border-t border-white/10 bg-black/40 px-4 py-3 backdrop-blur-sm">
        <ToggleAudioPublishingButton />
        <ToggleVideoPublishingButton />
        <ScreenShareButton />
        <CancelCallButton onLeave={onLeave} />
      </footer>
    </div>
  );
}

function TranscriptionPill() {
  const { useIsCallTranscribingInProgress } = useCallStateHooks();
  const isTranscribing = useIsCallTranscribingInProgress();
  // Surface a tiny "transcribing" indicator to participants. If for any
  // reason transcription didn't start (call type capability denied), this
  // disappears so we're not misleading anyone.
  useEffect(() => {
    if (!isTranscribing) {
      console.debug("meeting: transcription not running");
    }
  }, [isTranscribing]);
  if (!isTranscribing) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300">
      <Sparkles className="size-3" />
      Transcribing
    </span>
  );
}
