import type { MeetingRecurrence } from "@/lib/db/types";
import { expandRecurrence } from "@/lib/calendar/recurrence";

/**
 * Where a meeting is in its life — pure, client-safe, and the ONE place the
 * meetings index and the meeting page decide it, so the two can't disagree.
 *
 * The data has no explicit status column. The real pipeline is:
 *
 *   meetings row (start route / calendar / agent) → someone leaves the call →
 *   `ended_at` stamped (`/api/meetings/:id/end`) → Stream fires
 *   `call.transcription_ready` minutes later → `meeting_transcripts` row →
 *   Grok summary → `meeting_summaries` row.
 *
 * Every stage after the first is best-effort, so most of the states below are
 * "a stage never happened". The old list collapsed all of them into a
 * perpetual "Processing…" (ended + no summary), which is how a May meeting
 * still read as processing in October. Anything past a real pipeline's
 * worst case is shown as what it is instead.
 */

/** A walk-up call with no `ended_at` after this long was abandoned (tab
 *  closed, crash) — nobody is in it. */
export const LIVE_STALE_MS = 6 * 60 * 60 * 1000;
/** Transcript + summary land within minutes of a call ending; an hour is
 *  far past any real run. */
export const PROCESSING_STALE_MS = 60 * 60 * 1000;
/** A scheduled slot still counts as "happening now" this long past its end. */
const SCHEDULED_GRACE_MS = 15 * 60 * 1000;
/** Look-ahead for a recurring series' next occurrence. */
const SERIES_HORIZON_MS = 400 * 24 * 60 * 60 * 1000;

export type MeetingStatusInput = {
  started_at: string | null;
  ended_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  stream_call_type: string;
  recurrence: MeetingRecurrence | null;
  created_at: string;
  has_summary: boolean;
  transcript: {
    status: "pending" | "fetched" | "failed" | string;
    created_at: string;
  } | null;
};

export type PastOutcome =
  | "summary_ready"
  /** Transcript saved, summary still inside the normal window. */
  | "summarizing"
  /** Transcript saved, summary never landed (model failure). */
  | "summary_failed"
  | "transcript_failed"
  /** Ended recently, transcript not here yet — the only honest "Processing…". */
  | "processing"
  /** Nothing was ever captured (transcription never ran / nobody joined). */
  | "no_transcript"
  /** A calendar entry without a video call — there was nothing to record. */
  | "no_call";

export type MeetingState =
  | { phase: "upcoming"; startAt: string; endAt: string | null }
  | {
      phase: "live";
      /** `call` = a walk-up call in progress; `scheduled` = inside its slot. */
      kind: "call" | "scheduled";
      startAt: string;
      endAt: string | null;
    }
  | {
      phase: "past";
      outcome: PastOutcome;
      startAt: string;
      /** When it ended, if known — abandoned calls have no end. */
      endAt: string | null;
    };

export type StatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "info"
  | "danger"
  | "violet";

export function meetingState(
  m: MeetingStatusInput,
  now: number,
): MeetingState {
  const scheduled = m.scheduled_start !== null;

  // A recurring series is one row: joining-then-leaving one occurrence stamps
  // `ended_at` on the whole row, but the NEXT occurrence is still upcoming.
  if (scheduled && m.recurrence && m.ended_at) {
    const slot = currentOrNextSlot(m, now);
    if (slot && new Date(slot.start).getTime() > new Date(m.ended_at).getTime()) {
      return new Date(slot.start).getTime() > now
        ? { phase: "upcoming", startAt: slot.start, endAt: slot.end }
        : { phase: "live", kind: "scheduled", startAt: slot.start, endAt: slot.end };
    }
  }

  if (m.ended_at) {
    const startAt = scheduled
      ? m.scheduled_start!
      : (m.started_at ?? m.created_at);
    return {
      phase: "past",
      outcome: pastOutcome(m, now),
      startAt,
      endAt: m.ended_at,
    };
  }

  if (scheduled) {
    const slot = currentOrNextSlot(m, now);
    if (slot) {
      const startMs = new Date(slot.start).getTime();
      if (startMs > now) {
        return { phase: "upcoming", startAt: slot.start, endAt: slot.end };
      }
      return {
        phase: "live",
        kind: "scheduled",
        startAt: slot.start,
        endAt: slot.end,
      };
    }
    return {
      phase: "past",
      outcome: pastOutcome(m, now),
      startAt: lastSlotStart(m),
      endAt: m.scheduled_end,
    };
  }

  const startAt = m.started_at ?? m.created_at;
  if (now - new Date(startAt).getTime() < LIVE_STALE_MS) {
    return { phase: "live", kind: "call", startAt, endAt: null };
  }
  return { phase: "past", outcome: pastOutcome(m, now), startAt, endAt: null };
}

function pastOutcome(m: MeetingStatusInput, now: number): PastOutcome {
  if (m.has_summary) return "summary_ready";
  if (m.transcript?.status === "failed") return "transcript_failed";
  if (m.transcript) {
    const age = now - new Date(m.transcript.created_at).getTime();
    return age < PROCESSING_STALE_MS ? "summarizing" : "summary_failed";
  }
  if (m.stream_call_type !== "default") return "no_call";
  if (m.ended_at && now - new Date(m.ended_at).getTime() < PROCESSING_STALE_MS) {
    return "processing";
  }
  return "no_transcript";
}

/** The slot a scheduled meeting occupies now or next, or null when its
 *  (last) slot is over. Recurring series walk forward to the next one. */
function currentOrNextSlot(
  m: MeetingStatusInput,
  now: number,
): { start: string; end: string | null } | null {
  const start = m.scheduled_start!;
  const end = m.scheduled_end ?? start;
  if (!m.recurrence) {
    const endMs = new Date(end).getTime() + SCHEDULED_GRACE_MS;
    return endMs >= now ? { start, end: m.scheduled_end } : null;
  }
  const duration = new Date(end).getTime() - new Date(start).getTime();
  const occurrences = expandRecurrence(
    { id: "x", scheduled_start: start, scheduled_end: end, recurrence: m.recurrence },
    new Date(now - duration - SCHEDULED_GRACE_MS),
    new Date(now + SERIES_HORIZON_MS),
  );
  const hit = occurrences.find(
    (o) => new Date(o.scheduled_end).getTime() + SCHEDULED_GRACE_MS >= now,
  );
  return hit ? { start: hit.scheduled_start, end: hit.scheduled_end } : null;
}

function lastSlotStart(m: MeetingStatusInput): string {
  return m.scheduled_start ?? m.started_at ?? m.created_at;
}

export function outcomeLabel(outcome: PastOutcome): {
  label: string;
  tone: StatusTone;
  hint: string;
} {
  switch (outcome) {
    case "summary_ready":
      return { label: "Summary ready", tone: "violet", hint: "AI notes are ready." };
    case "summarizing":
      return {
        label: "Summarizing…",
        tone: "info",
        hint: "The transcript arrived; notes are being written.",
      };
    case "summary_failed":
      return {
        label: "Summary failed",
        tone: "warning",
        hint: "The transcript was saved, but the AI summary never finished. The full transcript is on the meeting page.",
      };
    case "transcript_failed":
      return {
        label: "Transcript failed",
        tone: "danger",
        hint: "Stream sent a transcript that couldn't be fetched.",
      };
    case "processing":
      return {
        label: "Processing…",
        tone: "neutral",
        hint: "Waiting for the transcript — it usually lands a few minutes after the call ends.",
      };
    case "no_transcript":
      return {
        label: "No transcript",
        tone: "neutral",
        hint: "No recording or transcript was captured — transcription didn't run, or nobody joined.",
      };
    case "no_call":
      return {
        label: "No call",
        tone: "neutral",
        hint: "A calendar entry without a video call — nothing to record.",
      };
  }
}

export function stateBadge(state: MeetingState): {
  label: string;
  tone: StatusTone;
  hint: string;
} {
  if (state.phase === "upcoming") {
    return { label: "Scheduled", tone: "info", hint: "Not started yet." };
  }
  if (state.phase === "live") {
    return state.kind === "call"
      ? { label: "Live", tone: "success", hint: "A call is in progress." }
      : { label: "Now", tone: "success", hint: "Scheduled for right now." };
  }
  return outcomeLabel(state.outcome);
}

export type MeetingGroups<T> = {
  live: T[];
  upcoming: T[];
  past: T[];
};

/** Group + order: live by start, upcoming soonest first, past newest first. */
export function groupMeetings<T extends MeetingStatusInput>(
  meetings: T[],
  now: number,
): MeetingGroups<T & { state: MeetingState }> {
  const out: MeetingGroups<T & { state: MeetingState }> = {
    live: [],
    upcoming: [],
    past: [],
  };
  for (const m of meetings) {
    const state = meetingState(m, now);
    out[state.phase].push({ ...m, state });
  }
  const at = (x: { state: MeetingState }) => new Date(x.state.startAt).getTime();
  out.live.sort((a, b) => at(a) - at(b));
  out.upcoming.sort((a, b) => at(a) - at(b));
  out.past.sort((a, b) => at(b) - at(a));
  return out;
}

/** Case-insensitive title / channel / participant match. */
export function matchesMeetingQuery(
  m: { title: string; channel_name: string | null; speakers?: Array<{ name: string }> },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    m.title,
    m.channel_name ?? "",
    ...(m.speakers ?? []).map((s) => s.name),
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word.replace(/^#/, "")));
}
