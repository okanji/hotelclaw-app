import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { parseTurnStep, upsertTurnStep, type TurnStep } from "@hotelclaw/chat-ui/turn";
import { supabase } from "../lib/supabase";
import { TurnTrace } from "./ai/TurnTrace";

/**
 * "Hotelclaw is thinking…" row for the channel bot — the mobile twin of
 * `apps/web/components/chat/ai-thinking-indicator.tsx`.
 *
 * Driven by the DB turn claim, NOT Stream typing events: eve turns legitimately
 * run 30s to minutes, and Stream expires typing client-side after seconds, so
 * the native indicator would vanish mid-turn. `channel_bot_sessions.turn_state`
 * is the truth — `running` the moment the webhook claims the turn, back to
 * `idle` once the reply posts — and Realtime pushes both edges (0078
 * publication + member SELECT RLS). The turn's structured rows
 * (`channel_bot_activity`, 0113) stream in the same way — an INSERT opens a
 * step, an UPDATE settles it in place — and render as the same `TurnTrace`
 * the delivered reply will carry, so the live view and the settled view are
 * one component.
 *
 * Root conversation only: thread turns deliver into their thread, and `job:`
 * rows run detached for minutes by design.
 */
type SessionRow = {
  thread_key?: string;
  turn_state?: string;
  turn_activity?: string | null;
  turn_nonce?: string | null;
};

export function AiThinkingIndicator({
  streamChannelId,
}: {
  streamChannelId: string;
}) {
  const [thinking, setThinking] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [steps, setSteps] = useState<TurnStep[]>([]);
  const [longRunning, setLongRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const applyRow = (row: SessionRow | null) => {
      if (!row || row.thread_key !== "_root") return;
      const running = row.turn_state === "running";
      // A new turn starts from an empty feed; the delivered reply keeps the
      // finished turn's steps via its own `eve_steps` / `eve_turn` fields.
      if (!running) setSteps([]);
      setThinking(running);
      setNonce(running ? (row.turn_nonce ?? null) : null);
      setActivity(row.turn_activity?.trim() || null);
      // Every edge (turn start OR end) restarts the long-running clock.
      setLongRunning(false);
    };

    void supabase
      .from("channel_bot_sessions")
      .select("thread_key, turn_state, turn_activity, turn_nonce")
      .eq("channel_id", streamChannelId)
      .eq("thread_key", "_root")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        applyRow(data);
        // Mount mid-turn: backfill the steps so far; the realtime feed
        // merges by row id from here on.
        if (data.turn_state === "running" && data.turn_nonce) {
          void supabase
            .from("channel_bot_activity")
            .select(
              "id, kind, label, call_id, task_id, tool_name, input, output, detail, status, created_at, settled_at, thread_key",
            )
            .eq("channel_id", streamChannelId)
            .eq("turn_nonce", data.turn_nonce)
            .order("created_at", { ascending: true })
            .limit(80)
            .then(({ data: rows }) => {
              if (cancelled || !rows) return;
              setSteps((prev) =>
                (rows as Record<string, unknown>[])
                  .filter((r) => r.thread_key === "_root")
                  .map(parseTurnStep)
                  .filter((s): s is TurnStep => s !== null)
                  .reduce((acc, s) => upsertTurnStep(acc, s), prev),
              );
            });
        }
      });

    // Unique topic per mount — a shared topic name crashes on double-mount.
    const channel = supabase
      .channel(
        `ai-thinking:${streamChannelId}:${Math.random().toString(36).slice(2)}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_bot_activity",
          filter: `channel_id=eq.${streamChannelId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.thread_key !== "_root") return;
          const step = parseTurnStep(row);
          if (!step) return;
          setSteps((prev) => upsertTurnStep(prev, step));
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
        (payload) => applyRow(payload.new as SessionRow),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [streamChannelId]);

  // After 25s, soften the copy so a long turn reads as work rather than a hang.
  useEffect(() => {
    if (!thinking) return;
    const timer = setTimeout(() => setLongRunning(true), 25_000);
    return () => clearTimeout(timer);
  }, [thinking]);

  if (!thinking) return null;

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>H</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name}>Hotelclaw</Text>
        {/* The turn as a live trace: the summary line is eve's status line —
            the latest work, never reset to a generic "Thinking" between
            steps — and it opens into the steps so far, each settling in
            place as its result lands. */}
        <TurnTrace
          key={nonce ?? "turn"}
          live
          steps={steps}
          activity={activity ?? (longRunning ? "Still working on it…" : "Thinking…")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "700", color: "#374151" },
  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 15, fontWeight: "600" },
});
