"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MessageCircleQuestion } from "lucide-react";
import {
  AiElapsed,
  AiPixelGrid,
  AiShimmerLabel,
} from "@/components/ui/ai-loader";
import { createClient } from "@/lib/supabase/client";

/** A background job currently worth showing: still working, or parked on a
 *  question nobody has answered yet. */
type ActiveJob = {
  id: string;
  headline: string;
  activity: string | null;
  awaitingAnswer: boolean;
};

/** Client-side mirror of the runtime's `pendingQuestions` filter — a park
 *  with no prompt is an internal request with nothing for a human to answer. */
function hasPendingQuestion(pendingApproval: unknown): boolean {
  const requests = (pendingApproval as { requests?: unknown } | null)?.requests;
  if (!Array.isArray(requests)) return false;
  return requests.some((r) => {
    const prompt = (r as { prompt?: unknown }).prompt;
    return typeof prompt === "string" && prompt.trim().length > 0;
  });
}

/**
 * "Hotelclaw is thinking…" row for the channel bot — driven by the DB turn
 * claim, not Stream typing events. Stream's native typing indicator expires
 * client-side after a few seconds, but eve turns legitimately run 30s to
 * minutes, so the old indicator vanished mid-turn and left people guessing
 * whether the bot was still working. `channel_bot_sessions.turn_state` is
 * the truth: claimed (`running`) the moment the webhook decides to reply,
 * reset to `idle` by the runtime right after the reply posts — so this row
 * spans the WHOLE turn. Realtime (0078 publication + member SELECT RLS)
 * pushes both edges.
 *
 * Rendering: PORTALED into `.str-chat__message-list-scroll` as the last
 * element of the scrollable content, so it scrolls WITH the conversation
 * like a real message row (a sibling row outside the list stayed pinned
 * above the composer while the chat scrolled — wrong). The avatar reuses
 * Stream's own avatar classes so color/radius match real bot messages
 * exactly, and the row mirrors the Slack message grid (22px inline start
 * padding, 36px avatar, 10px gap — the `--slack-avatar-*` tokens).
 *
 * BACKGROUND JOBS get their own strip above that row. They were invisible
 * until 2026-08-11: a `kind='job'` row carries a synthetic `job:<uuid>`
 * thread key, and this component bailed on anything that wasn't `_root`, so
 * an eight-minute SOP audit ran with no sign of life anywhere in the UI —
 * even though `recordActivity` had been writing its every step to
 * `channel_bot_activity` the whole time. Jobs are long by design and can now
 * park on a question, so the strip shows both states: what the job is doing,
 * or that it is waiting on someone.
 */
export function AiThinkingIndicator({
  streamChannelId,
}: {
  streamChannelId: string;
}) {
  const [thinking, setThinking] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  // Steps of the CURRENT turn, oldest first (migration 0096). The last entry
  // is the live one; earlier ones stay visible so the user can see the path
  // taken rather than just the current stop. Keyed by row id so the mount-time
  // backfill and the realtime feed can merge without duplicating a step.
  const [steps, setSteps] = useState<{ id: string; label: string }[]>([]);
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [longRunning, setLongRunning] = useState(false);
  const [portalEl, setPortalEl] = useState<Element | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const applyRow = (
      row: {
        id?: string;
        kind?: string;
        thread_key?: string;
        turn_state?: string;
        turn_activity?: string | null;
        job_headline?: string | null;
        pending_approval?: unknown;
      } | null,
    ) => {
      if (!row) return;

      // Background jobs: their own strip, keyed by row id. A job leaves the
      // strip the moment it stops working AND stops waiting — which is
      // exactly when its result (or its question) has landed in the channel.
      if (row.kind === "job") {
        if (!row.id) return;
        const awaitingAnswer = hasPendingQuestion(row.pending_approval);
        const active = row.turn_state === "running" || awaitingAnswer;
        setJobs((prev) => {
          const rest = prev.filter((j) => j.id !== row.id);
          if (!active) return rest;
          return [
            ...rest,
            {
              id: row.id as string,
              headline: row.job_headline?.trim() || "Background job",
              activity: row.turn_activity?.trim() || null,
              awaitingAnswer,
            },
          ].sort((a, b) => a.id.localeCompare(b.id));
        });
        return;
      }

      // Root conversation only: thread turns deliver into their thread.
      if (row.thread_key !== "_root") return;
      const running = row.turn_state === "running";
      // A new turn starts from an empty feed; the delivered reply keeps the
      // finished turn's steps via its own `eve_steps` field.
      if (!running) setSteps([]);
      setThinking(running);
      // What the runtime is actually doing this step (migration 0095);
      // null between steps, which falls back to the generic copy below.
      setActivity(row.turn_activity?.trim() || null);
      // Every edge (turn start OR end) restarts the long-running clock.
      setLongRunning(false);
    };

    supabase
      .from("channel_bot_sessions")
      // turn_activity is selected explicitly rather than with "*" so a
      // pre-0095 database fails this one query loudly instead of silently
      // dropping the column.
      .select("id, kind, thread_key, turn_state, turn_activity, turn_nonce")
      .eq("channel_id", streamChannelId)
      .eq("thread_key", "_root")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        applyRow(data);
        // Backfill the steps already taken this turn. The realtime feed only
        // delivers INSERTs from subscription onward, so a viewer who opens
        // (or returns to) the channel mid-turn would otherwise see the turn
        // restart from a bare "Thinking…" with its history gone.
        if (data.turn_state === "running" && data.turn_nonce) {
          supabase
            .from("channel_bot_activity")
            .select("id, label")
            .eq("channel_id", streamChannelId)
            .eq("thread_key", "_root")
            .eq("turn_nonce", data.turn_nonce)
            .order("created_at", { ascending: true })
            .then(({ data: rows }) => {
              if (cancelled || !rows?.length) return;
              // Prepend history; keep any live inserts that raced this query
              // (dedup by row id) in their arrival order after it.
              setSteps((prev) => [
                ...rows,
                ...prev.filter((s) => !rows.some((r) => r.id === s.id)),
              ]);
            });
        }
      });

    // Jobs already in flight when the channel opens — a job started before
    // this mount has no realtime edge left to replay.
    supabase
      .from("channel_bot_sessions")
      .select(
        "id, kind, thread_key, turn_state, turn_activity, job_headline, pending_approval",
      )
      .eq("channel_id", streamChannelId)
      .eq("kind", "job")
      .or("turn_state.eq.running,pending_approval.not.is.null")
      .then(({ data }) => {
        if (cancelled) return;
        for (const row of data ?? []) applyRow(row);
      });

    const pushStep = (id: unknown, label: unknown) => {
      if (typeof id !== "string" || typeof label !== "string" || !label.trim())
        return;
      setSteps((prev) =>
        prev.some((s) => s.id === id) ? prev : [...prev, { id, label }],
      );
    };

    const channel = supabase
      .channel(
        `ai-thinking:${streamChannelId}:${Math.random().toString(36).slice(2)}`,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_bot_activity",
          filter: `channel_id=eq.${streamChannelId}`,
        },
        (payload) => {
          const inserted = payload.new as {
            id?: string;
            thread_key?: string;
            label?: string;
          };
          if (inserted.thread_key !== "_root") return;
          pushStep(inserted.id, inserted.label);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_bot_sessions",
          filter: `channel_id=eq.${streamChannelId}`,
        },
        (payload) => {
          applyRow(
            payload.new as {
              id?: string;
              kind?: string;
              thread_key?: string;
              turn_state?: string;
              turn_activity?: string | null;
              job_headline?: string | null;
              pending_approval?: unknown;
            },
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [streamChannelId]);

  // After 25s of one turn, soften the copy so a long-running turn reads as
  // deliberate work rather than a hang. (Reset happens edge-triggered in
  // applyRow — no synchronous setState here.)
  useEffect(() => {
    if (!thinking) return;
    const timer = setTimeout(() => setLongRunning(true), 25_000);
    return () => clearTimeout(timer);
  }, [thinking]);

  // A running job keeps the strip mounted even when the conversation itself
  // is idle — that is the whole point of showing detached work.
  const visible = thinking || jobs.length > 0;

  // Find the list's scrollable content and portal into it (rAF: DOM query +
  // setState must not run synchronously inside the effect body).
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      const scope = anchorRef.current?.parentElement ?? document;
      setPortalEl(scope.querySelector(".str-chat__message-list-scroll"));
    });
    return () => cancelAnimationFrame(id);
  }, [visible]);

  // Keep the viewer pinned to the bottom while the row is up (they almost
  // always just sent the trigger message). This must be a poll, not a
  // one-shot: Stream loads messages asynchronously and scrolls to the
  // bottom of the MESSAGES after our row is already in the DOM, stranding
  // the row one row-height below the fold on a mid-turn page load. The
  // interval re-pins whenever the viewer is near-but-not-at the bottom;
  // scrolled-up readers (gap ≥ 400) are never yanked.
  useEffect(() => {
    if (!visible || !portalEl) return;
    const pin = () => {
      // Nearest scrollable ANCESTOR of the list content (`.str-chat__message-list`
      // here — but found structurally, so a Stream class rename can't break it).
      let scroller: HTMLElement | null =
        portalEl.parentElement as HTMLElement | null;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
        scroller = scroller.parentElement;
      }
      if (!scroller) return;
      const gap =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (gap > 1 && gap < 400) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    };
    const id = requestAnimationFrame(pin);
    const interval = setInterval(pin, 400);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(interval);
    };
  }, [visible, portalEl]);

  const row =
    visible && portalEl
      ? createPortal(
          <>
            {/* Detached work, one line each. Deliberately NOT dressed as a
                bot message: a job is not part of the conversation, it is
                something running alongside it. */}
            {jobs.map((job) => (
              <div key={job.id} className="py-1.5 pl-[22px] pr-4">
                <div className="flex max-w-[560px] items-start gap-2.5 rounded-md px-2.5 py-2 shadow-ring">
                  {job.awaitingAnswer ? (
                    <MessageCircleQuestion
                      className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]"
                      aria-hidden
                    />
                  ) : (
                    <AiPixelGrid className="mt-1" />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {job.headline}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {job.awaitingAnswer
                        ? "Paused — waiting for your answer above"
                        : job.activity ?? "Running in the background…"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {thinking ? (
              <div className="flex items-start gap-[10px] py-1.5 pl-[22px] pr-4">
                <div className="str-chat__avatar str-chat__avatar--with-border str-chat__avatar--one-letter str-chat__avatar--size-md shrink-0 opacity-80">
                  <div className="str-chat__avatar-initials">H</div>
                </div>
                <div className="flex min-w-0 flex-col">
                  {/* The chat column is the Slack-mirror world with its own local
                  scale (app/stream-chat-overrides.css). This row sits INSIDE
                  the message list and must line up with real message headers
                  exactly, so it reads the same `--slack-msg-display-name-*`
                  tokens they do rather than re-typing 15px/22px. */}
                  <span
                    className="leading-[22px]"
                    style={{
                      fontSize: "var(--slack-msg-display-name-size)",
                      fontWeight: "var(--slack-msg-display-name-weight)",
                    }}
                  >
                    Hotelclaw
                  </span>
                  {/* Activity feed: the steps already taken, muted and dimmed,
                  with the live one spinning at the bottom. Shows the path
                  taken rather than only the current stop — a long turn stops
                  looking like a hang. Capped so a 20-tool turn can't push the
                  conversation off screen. */}
                  {steps
                    .slice(0, -1)
                    .slice(-4)
                    .map((step) => (
                      <span
                        key={step.id}
                        className="flex items-center gap-2 pt-0.5 text-sm text-muted-foreground/60"
                      >
                        <Check className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{step.label}</span>
                      </span>
                    ))}
                  {/* The live step: pixel-grid wavefront + shimmer + a turn
                  timer that starts when the turn claims and unmounts (resets)
                  when it delivers. Long eve turns read as deliberate work. */}
                  <span className="flex items-center gap-2.5 pt-0.5 text-sm">
                    <AiPixelGrid />
                    <AiShimmerLabel className="min-w-0 truncate">
                      {activity ??
                        (longRunning ? "Still working on it…" : "Thinking…")}
                    </AiShimmerLabel>
                    <AiElapsed />
                  </span>
                </div>
              </div>
            ) : null}
          </>,
          portalEl,
        )
      : null;

  return (
    <>
      {/* Invisible anchor — scopes the DOM query to THIS channel's window. */}
      <span ref={anchorRef} className="hidden" />
      {row}
    </>
  );
}
