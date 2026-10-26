import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { contextUsage, formatTokens, type TurnUsage } from "@hotelclaw/chat-ui/turn";

/**
 * Context meter for one reply — the phone twin of the web's `TurnUsageMeter`
 * (the shadcn/ui AI Elements "Context" pattern): "N% context" that opens
 * into a bar and the token breakdown. The arithmetic is the shared
 * `contextUsage`, so both apps read the same percent off `eve_usage`.
 */
export function ContextMeter({ usage }: { usage: TurnUsage }) {
  const [open, setOpen] = useState(false);
  const context = contextUsage(usage);
  return (
    <View style={styles.wrap}>
      <Pressable
        hitSlop={8}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.trigger}>{context.percent}% context</Text>
      </Pressable>
      {open ? (
        <View style={styles.panel}>
          <View style={styles.headRow}>
            <Text style={styles.headTitle}>Context</Text>
            <Text style={styles.headMeta}>
              {formatTokens(context.used)} / {formatTokens(context.limit)}
            </Text>
          </View>
          <View style={styles.bar} accessibilityRole="progressbar">
            <View style={[styles.barFill, { width: `${context.percent}%` }]} />
          </View>
          {context.rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
          {context.footer ? (
            <View style={styles.footer}>
              <Text style={styles.footerModel} numberOfLines={1}>
                {context.model ?? "model"}
              </Text>
              <Text style={styles.footerMeta}>{context.footer}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  trigger: { fontSize: 12, color: "#9ca3af", fontVariant: ["tabular-nums"] },
  panel: {
    width: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 10,
    gap: 6,
  },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headTitle: { fontSize: 13, fontWeight: "600", color: "#111827" },
  headMeta: { fontSize: 12, color: "#6b7280", fontVariant: ["tabular-nums"] },
  bar: { height: 6, borderRadius: 3, backgroundColor: "#f3f4f6", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: "#111827" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { fontSize: 12, color: "#6b7280" },
  rowValue: { fontSize: 12, color: "#111827", fontVariant: ["tabular-nums"] },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
    paddingTop: 6,
    marginTop: 2,
  },
  footerModel: { fontFamily: "Menlo", fontSize: 11, color: "#6b7280", flexShrink: 1 },
  footerMeta: { fontSize: 11, color: "#6b7280", fontVariant: ["tabular-nums"] },
});
