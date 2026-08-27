import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { fadeUpEntering, statusFadeIn } from "./AiLoader";
import { apiFetch, useApi } from "../lib/api";

/**
 * AI triage suggestions on a task — the mobile twin of web's
 * `components/tasks/task-triage-suggestions.tsx`, styled per Beautiful UI's
 * RecommendationCard: recommendation body, a 3-bar confidence meter, and
 * Accept / Dismiss without the card changing shape. The alternatives drawer
 * is omitted on both platforms (the API carries no candidate list).
 *
 * Values were validated server-side against real members/teams when the
 * suggestion was written; accepting POSTs and the server applies the field.
 */

type Suggestion = {
  id: string;
  field: "space" | "assignee" | "priority";
  suggested_value: string;
  display_value: string;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  status: "pending" | "auto_applied";
};

const FIELD_LABEL: Record<Suggestion["field"], string> = {
  space: "team",
  assignee: "assignee",
  priority: "priority",
};

const CONFIDENCE_LABEL: Record<Suggestion["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Needs review",
};

const CONFIDENCE_BARS: Record<Suggestion["confidence"], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const CONFIDENCE_COLOR: Record<Suggestion["confidence"], string> = {
  high: "#16a34a",
  medium: "#d97706",
  low: "#9ca3af",
};

function Meter({ confidence }: { confidence: Suggestion["confidence"] }) {
  const filled = CONFIDENCE_BARS[confidence];
  const color = CONFIDENCE_COLOR[confidence];
  return (
    <View style={styles.meter}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.meterBar,
            { height: 5 + i * 3 },
            i < filled ? { backgroundColor: color } : null,
          ]}
        />
      ))}
    </View>
  );
}

export function TriageSuggestions({
  propertyId,
  taskId,
  onApplied,
}: {
  propertyId: string;
  taskId: string;
  /** Called after an accept lands so the task screen can refetch the row. */
  onApplied: () => void;
}) {
  const base = `/api/properties/${propertyId}/tasks/${taskId}/suggestions`;
  const { data, refetch } = useApi<{ suggestions: Suggestion[] }>(base);
  // id → resolution, so a decided card settles in place instead of vanishing.
  const [resolved, setResolved] = useState<
    Record<string, "accepted" | "dismissed" | "busy">
  >({});

  const decide = async (id: string, action: "accept" | "dismiss") => {
    if (resolved[id]) return;
    setResolved((r) => ({ ...r, [id]: "busy" }));
    try {
      await apiFetch(base, { method: "POST", body: { suggestionId: id, action } });
      setResolved((r) => ({
        ...r,
        [id]: action === "accept" ? "accepted" : "dismissed",
      }));
      if (action === "accept") onApplied();
      refetch();
    } catch {
      setResolved((r) => {
        const { [id]: _dropped, ...rest } = r;
        return rest;
      });
    }
  };

  const suggestions = data?.suggestions ?? [];
  const pending = suggestions.filter(
    (s) => s.status === "pending" && resolved[s.id] !== "dismissed",
  );
  const auto = suggestions.filter((s) => s.status === "auto_applied");
  if (pending.length === 0 && auto.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>Suggestions</Text>
      {pending.map((s, i) => {
        const state = resolved[s.id];
        return (
          <Animated.View key={s.id} entering={fadeUpEntering(i)} style={styles.card}>
            <Text style={styles.question}>
              Set {FIELD_LABEL[s.field]} to{" "}
              <Text style={styles.value}>{s.display_value}</Text>?
            </Text>
            {s.reasoning ? (
              <Text style={styles.reasoning}>{s.reasoning}</Text>
            ) : null}
            <View style={styles.footer}>
              <View style={styles.confidence}>
                <Meter confidence={s.confidence} />
                <Text style={styles.confidenceLabel}>
                  {CONFIDENCE_LABEL[s.confidence]}
                </Text>
              </View>
              {state === "accepted" ? (
                <Animated.View entering={statusFadeIn()} style={styles.accepted}>
                  <Ionicons name="checkmark-circle" size={15} color="#16a34a" />
                  <Text style={styles.acceptedText}>Applied</Text>
                </Animated.View>
              ) : (
                <View style={styles.actions}>
                  <Pressable
                    disabled={state === "busy"}
                    onPress={() => void decide(s.id, "dismiss")}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.dismiss,
                      (pressed || state === "busy") && styles.pressedDim,
                    ]}
                  >
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </Pressable>
                  <Pressable
                    disabled={state === "busy"}
                    onPress={() => void decide(s.id, "accept")}
                    style={({ pressed }) => [
                      styles.accept,
                      (pressed || state === "busy") && styles.pressedDim,
                    ]}
                  >
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </Animated.View>
        );
      })}
      {auto.map((s) => (
        <View key={s.id} style={styles.autoRow}>
          <Ionicons name="sparkles" size={12} color="#9ca3af" />
          <Text style={styles.autoText} numberOfLines={1}>
            {FIELD_LABEL[s.field].charAt(0).toUpperCase() +
              FIELD_LABEL[s.field].slice(1)}{" "}
            set automatically · {s.display_value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    padding: 12,
    gap: 6,
  },
  question: { fontSize: 14, fontWeight: "500", color: "#111827" },
  value: { fontWeight: "600" },
  reasoning: { fontSize: 13, color: "#6b7280", lineHeight: 18 },
  footer: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  confidence: { flexDirection: "row", alignItems: "center", gap: 6 },
  meter: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  meterBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: "#e5e7eb",
  },
  confidenceLabel: { fontSize: 12, color: "#9ca3af" },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  dismiss: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  dismissText: { fontSize: 13, fontWeight: "500", color: "#6b7280" },
  accept: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#111827",
  },
  acceptText: { fontSize: 13, fontWeight: "600", color: "#ffffff" },
  accepted: { flexDirection: "row", alignItems: "center", gap: 4 },
  acceptedText: { fontSize: 13, fontWeight: "500", color: "#16a34a" },
  pressedDim: { opacity: 0.6 },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  autoText: { fontSize: 12, color: "#9ca3af", flexShrink: 1 },
});
