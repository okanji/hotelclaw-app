"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resampleWaveformData } from "stream-chat-react";

/**
 * Hand-rolled Slack-style voice recorder for the custom composer.
 *
 * Why not Stream's own recorder: `MediaRecorderController` is not exported
 * from `stream-chat-react` (and the package `exports` map blocks deep
 * imports), so this hook mirrors its behavior instead — same mime selection
 * (webm, mp4 on Safari), same amplitude sampling (AnalyserNode fftSize 32,
 * RMS of byte frequency bins / 255 every 60ms), same transcode step (non-mp4
 * → mp3 @ 16kHz via the public `stream-chat-react/mp3-encoder` subpath,
 * which uses @breezystack/lamejs), and the same `voiceRecording` attachment
 * fields (`duration` in SECONDS, `waveform_data` resampled to 100 samples)
 * that Stream's `VoiceRecordingPlayer` renders.
 */

/** Stream's DEFAULT_AMPLITUDE_RECORDER_CONFIG.sampleCount. */
const WAVEFORM_SAMPLE_COUNT = 100;
/** Stream's DEFAULT_AMPLITUDE_RECORDER_CONFIG.samplingFrequencyMs. */
const AMPLITUDE_SAMPLING_MS = 60;
const ANALYSER_FFT_SIZE = 32;
const ANALYSER_MAX_DECIBELS = 0;
const ANALYSER_MIN_DECIBELS = -100;
const MAX_FREQUENCY_AMPLITUDE = 255;
/** Stream's DEFAULT_AUDIO_TRANSCODER_CONFIG.sampleRate. */
const MP3_SAMPLE_RATE = 16_000;

export type VoiceRecorderStatus = "idle" | "recording" | "processing";

export type VoiceRecorderStartResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "no-mic" | "unsupported" | "error" };

export type VoiceRecordingResult = {
  /** Encoded audio, ready for `channel.sendFile`. */
  file: File;
  /** Playback length in seconds (Stream's `duration` unit). */
  durationSeconds: number;
  mimeType: string;
  /** 100 samples, 0..1 — Stream's `waveform_data` shape. */
  waveformData: number[];
};

/** "0:07" style m:ss for chips and the recording timer. */
export function formatAudioDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const rootMeanSquare = (values: Uint8Array) =>
  Math.sqrt(values.reduce((acc, v) => acc + v * v, 0) / (values.length || 1));

/** Mirror of Stream's RECORDED_MIME_TYPE_BY_BROWSER selection. */
function pickRecordingMimeType(): string | undefined {
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  // Safari — records AAC-in-mp4, which every browser plays; skips transcode.
  if (MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2"))
    return "audio/mp4;codecs=mp4a.40.2";
  return undefined;
}

export function useVoiceRecorder() {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [amplitudes, setAmplitudes] = useState<number[]>([]);

  const statusRef = useRef<VoiceRecorderStatus>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const samplingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const chunksRef = useRef<Blob[]>([]);
  const amplitudesRef = useRef<number[]>([]);
  const startedAtRef = useRef<number>(0);

  const setStatusBoth = useCallback((next: VoiceRecorderStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  /** Stop hardware + timers. Does NOT touch recorded data or status. */
  const releaseCapture = useCallback(() => {
    if (samplingIntervalRef.current) {
      clearInterval(samplingIntervalRef.current);
      samplingIntervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }, []);

  const cancel = useCallback(() => {
    const mr = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        // already stopped
      }
    }
    releaseCapture();
    chunksRef.current = [];
    amplitudesRef.current = [];
    setStatusBoth("idle");
    setElapsedMs(0);
    setAmplitudes([]);
  }, [releaseCapture, setStatusBoth]);

  // Unmount → drop the mic.
  useEffect(() => cancel, [cancel]);

  const start = useCallback(async (): Promise<VoiceRecorderStartResult> => {
    if (statusRef.current !== "idle") return { ok: true };
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return { ok: false, reason: "unsupported" };
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError")
        return { ok: false, reason: "denied" };
      if (name === "NotFoundError" || name === "OverconstrainedError")
        return { ok: false, reason: "no-mic" };
      console.error("voice recorder: getUserMedia failed", err);
      return { ok: false, reason: "error" };
    }
    try {
      const mimeType = pickRecordingMimeType();
      const mr = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      amplitudesRef.current = [];
      mr.addEventListener("dataavailable", (e: BlobEvent) => {
        if (e.data.size) chunksRef.current.push(e.data);
      });
      mediaRecorderRef.current = mr;
      streamRef.current = stream;

      // Live amplitude sampling (Stream's AmplitudeRecorder recipe).
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.maxDecibels = ANALYSER_MAX_DECIBELS;
      analyser.minDecibels = ANALYSER_MIN_DECIBELS;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const frequencyBins = new Uint8Array(analyser.frequencyBinCount);
      samplingIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(frequencyBins);
        const normalized =
          rootMeanSquare(frequencyBins) / MAX_FREQUENCY_AMPLITUDE;
        amplitudesRef.current.push(normalized);
        setAmplitudes([...amplitudesRef.current]);
        setElapsedMs(Date.now() - startedAtRef.current);
      }, AMPLITUDE_SAMPLING_MS);

      startedAtRef.current = Date.now();
      mr.start();
      setElapsedMs(0);
      setAmplitudes([]);
      setStatusBoth("recording");
      return { ok: true };
    } catch (err) {
      console.error("voice recorder: failed to start", err);
      stream.getTracks().forEach((t) => t.stop());
      releaseCapture();
      return { ok: false, reason: "error" };
    }
  }, [releaseCapture, setStatusBoth]);

  const stop = useCallback(async (): Promise<VoiceRecordingResult | null> => {
    const mr = mediaRecorderRef.current;
    if (!mr || statusRef.current !== "recording") return null;
    setStatusBoth("processing");
    const durationMs = Date.now() - startedAtRef.current;
    // stop() flushes a final `dataavailable` before `stop` fires, so the
    // chunks array is complete once this resolves.
    await new Promise<void>((resolve) => {
      if (mr.state === "inactive") {
        resolve();
        return;
      }
      mr.addEventListener("stop", () => resolve(), { once: true });
      try {
        mr.stop();
      } catch {
        resolve();
      }
    });
    releaseCapture();
    mediaRecorderRef.current = null;
    try {
      const recordedType = mr.mimeType || "audio/webm";
      let blob: Blob = new Blob(chunksRef.current, { type: recordedType });
      if (!blob.size) throw new Error("empty recording");
      // Stream's rule: mp4 (Safari AAC) is universally playable as-is;
      // everything else (webm/opus) is transcoded to mp3 for cross-browser
      // playback. The encoder also bakes in correct duration metadata,
      // sidestepping Chrome's infamous webm Infinity-duration bug.
      let mimeType = blob.type;
      if (!/audio\/mp4/.test(mimeType)) {
        const { encodeToMp3 } = await import("stream-chat-react/mp3-encoder");
        blob = await encodeToMp3(
          new File([blob], "recording", { type: mimeType }),
          MP3_SAMPLE_RATE,
        );
        mimeType = blob.type; // audio/mp3;sbu_type=voice
      }
      const ext = mimeType.includes("mp3")
        ? "mp3"
        : mimeType.includes("mp4")
          ? "m4a"
          : "webm";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = new File([blob], `voice-message-${stamp}.${ext}`, {
        type: mimeType,
      });
      return {
        file,
        durationSeconds: durationMs / 1000,
        mimeType,
        waveformData: resampleWaveformData(
          amplitudesRef.current,
          WAVEFORM_SAMPLE_COUNT,
        ),
      };
    } catch (err) {
      console.error("voice recorder: processing failed", err);
      return null;
    } finally {
      chunksRef.current = [];
      amplitudesRef.current = [];
      setStatusBoth("idle");
      setElapsedMs(0);
      setAmplitudes([]);
    }
  }, [releaseCapture, setStatusBoth]);

  return { status, elapsedMs, amplitudes, start, stop, cancel };
}
