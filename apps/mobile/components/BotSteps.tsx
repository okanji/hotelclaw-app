import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { fadeUpEntering } from "./AiLoader";

/**
 * The steps behind a delivered bot reply, collapsed — mobile twin of
 * `apps/web/components/chat/ai-steps-disclosure.tsx`, styled per Beautiful
 * UI's ThinkingState/ToolChips settled state.
 *
 * The thinking indicator shows the feed live but is transient; the runtime
 * stamps the finished turn's steps onto the message as `eve_steps`
 * (channel-delivery.ts, migration 0096). Collapsed to one muted line —
 * "N steps · 32s" — so a 12-step turn doesn't bury the answer; expanding
 * reveals the detail rail with each step fading up.
 */
export type AiStep = { label: string; at: string };

export function isAiSteps(value: unknown): value is AiStep[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (s) =>
        !!s &&
        typeof s === "object" &&
        typeof (s as AiStep).label === "string" &&
        typeof (s as AiStep).at === "string",
    )
  );
}

function elapsed(steps: AiStep[]): string | null {
  const first = new Date(steps[0].at).getTime();
  const last = new Date(steps[steps.length - 1].at).getTime();
  if (Number.isNaN(first) || Number.isNaN(last) || last <= first) return null;
  const secs = Math.round((last - first) / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function BotSteps({ steps }: { steps: AiStep[] }) {
  const [open, setOpen] = useState(false);
  const took = elapsed(steps);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.header}
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={12}
          color="#9ca3af"
        />
        <Text style={styles.headerText}>
          {steps.length} step{steps.length === 1 ? "" : "s"}
          {took ? ` · ${took}` : ""}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.rail}>
          {steps.map((step, i) => (
            <Animated.View
              key={`${step.at}-${i}`}
              entering={fadeUpEntering(i)}
              style={styles.stepRow}
            >
              <Ionicons name="checkmark" size={12} color="#9ca3af" />
              <Text style={styles.stepText} numberOfLines={1}>
                {step.label}
              </Text>
            </Animated.View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 8,
    paddingBottom: 4,
    alignSelf: "stretch",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  headerText: {
    fontSize: 12,
    color: "#9ca3af",
    fontVariant: ["tabular-nums"],
  },
  rail: {
    marginTop: 2,
    marginLeft: 5,
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: "#e5e7eb",
    gap: 2,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stepText: {
    fontSize: 12,
    color: "#6b7280",
    flexShrink: 1,
  },
});
