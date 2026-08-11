import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";

/**
 * "Hotelclaw is thinking…" row for the channel bot — the mobile twin of
 * `apps/web/components/chat/ai-thinking-indicator.tsx`.
 *
 * Driven by the DB turn claim, NOT Stream typing events: eve turns legitimately
 * run 30s to minutes, and Stream expires typing client-side after seconds, so
 * the native indicator would vanish mid-turn. `channel_bot_sessions.turn_state`
 * is the truth — `running` the moment the webhook claims the turn, back to
 * `idle` once the reply posts — and Realtime pushes both edges (0078
 * publication + member SELECT RLS). Steps come from `channel_bot_activity`
 * (0096) so a long turn shows the path taken rather than one opaque spinner.
 *
 * Root conversation only: thread turns deliver into their thread, and `job:`
 * rows run detached for minutes by design.
 */
export function AiThinkingIndicator({
  streamChannelId,
}: {
  streamChannelId: string;
}) {
  const [thinking, setThinking] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [longRunning, setLongRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const applyRow = (
      row: {
        thread_key?: string;
        turn_state?: string;
        turn_activity?: string | null;
      } | null,
    ) => {
      if (!row || row.thread_key !== "_root") return;
      const running = row.turn_state === "running";
      // A new turn starts from an empty feed; the delivered reply keeps the
      // finished turn's steps via its own `eve_steps` field.
      if (!running) setSteps([]);
      setThinking(running);
      setActivity(row.turn_activity?.trim() || null);
      // Every edge (turn start OR end) restarts the long-running clock.
      setLongRunning(false);
    };

    void supabase
      .from("channel_bot_sessions")
      .select("thread_key, turn_state, turn_activity")
      .eq("channel_id", streamChannelId)
      .eq("thread_key", "_root")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) applyRow(data);
      });

    const pushStep = (label: unknown) => {
      if (typeof label !== "string" || !label.trim()) return;
      setSteps((prev) => (prev.at(-1) === label ? prev : [...prev, label]));
    };

    // Unique topic per mount — a shared topic name crashes on double-mount.
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
            thread_key?: string;
            label?: string;
          };
          if (inserted.thread_key !== "_root") return;
          pushStep(inserted.label);
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
        (payload) =>
          applyRow(
            payload.new as {
              thread_key?: string;
              turn_state?: string;
              turn_activity?: string | null;
            },
          ),
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
        {/* The path taken so far, capped so a 20-tool turn can't push the
            conversation off screen. */}
        {steps
          .slice(0, -1)
          .slice(-4)
          .map((step, i) => (
            <View key={`${step}-${i}`} style={styles.stepRow}>
              <Ionicons name="checkmark" size={13} color="#9ca3af" />
              <Text style={styles.stepDone} numberOfLines={1}>
                {step}
              </Text>
            </View>
          ))}
        <View style={styles.stepRow}>
          <ActivityIndicator size="small" />
          <Text style={styles.stepLive} numberOfLines={1}>
            {activity ?? (longRunning ? "Still working on it…" : "Thinking…")}
          </Text>
        </View>
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
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: "600" },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 2,
  },
  stepDone: { fontSize: 13, color: "#9ca3af", flexShrink: 1 },
  stepLive: { fontSize: 13, color: "#6b7280", flexShrink: 1 },
});
