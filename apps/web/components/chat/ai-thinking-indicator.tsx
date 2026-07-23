"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

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
 */
export function AiThinkingIndicator({
  streamChannelId,
}: {
  streamChannelId: string;
}) {
  const [thinking, setThinking] = useState(false);
  const [longRunning, setLongRunning] = useState(false);
  const [portalEl, setPortalEl] = useState<Element | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const applyRow = (row: { thread_key?: string; turn_state?: string } | null) => {
      // Root conversation only: thread turns deliver into their thread and
      // job rows (`job:<uuid>`) run detached for minutes by design.
      if (!row || row.thread_key !== "_root") return;
      setThinking(row.turn_state === "running");
      // Every edge (turn start OR end) restarts the long-running clock.
      setLongRunning(false);
    };

    supabase
      .from("channel_bot_sessions")
      .select("thread_key, turn_state")
      .eq("channel_id", streamChannelId)
      .eq("thread_key", "_root")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) applyRow(data);
      });

    const channel = supabase
      .channel(
        `ai-thinking:${streamChannelId}:${Math.random().toString(36).slice(2)}`,
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
          applyRow(payload.new as { thread_key?: string; turn_state?: string });
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

  // Find the list's scrollable content and portal into it (rAF: DOM query +
  // setState must not run synchronously inside the effect body).
  useEffect(() => {
    if (!thinking) return;
    const id = requestAnimationFrame(() => {
      const scope = anchorRef.current?.parentElement ?? document;
      setPortalEl(scope.querySelector(".str-chat__message-list-scroll"));
    });
    return () => cancelAnimationFrame(id);
  }, [thinking]);

  // Keep the viewer pinned to the bottom when the row appears — they almost
  // always just sent the trigger message.
  useEffect(() => {
    if (!thinking || !portalEl) return;
    const id = requestAnimationFrame(() => {
      const scroller = portalEl.closest(".str-chat__list") ?? portalEl;
      if (!(scroller instanceof HTMLElement)) return;
      const gap =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (gap < 400) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [thinking, portalEl]);

  const row =
    thinking && portalEl
      ? createPortal(
          <div className="flex items-start gap-[10px] py-1 pl-[22px] pr-4">
            <div className="str-chat__avatar str-chat__avatar--with-border str-chat__avatar--one-letter str-chat__avatar--size-md shrink-0">
              <div className="str-chat__avatar-initials">H</div>
            </div>
            <div className="flex min-w-0 flex-col pt-px">
              <span className="text-[15px] font-bold leading-[22px]">
                Hotelclaw
              </span>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {longRunning ? "Still working on it" : "Thinking"}
                <span className="inline-flex gap-0.5" aria-hidden>
                  <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                  <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </span>
              </span>
            </div>
          </div>,
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
