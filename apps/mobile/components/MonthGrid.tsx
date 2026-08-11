import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ApiCalendarEvent } from "../lib/api";

/** Local-midnight key so events group by the viewer's day, not UTC. */
export function dayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Compact month view, in the Apple/Google Calendar shape: a 6-row grid of the
 * month with a dot under any day that has events, and the selected day's list
 * rendered by the caller underneath. Deliberately dots-not-titles — a phone
 * month cell has no room for text, and the day list carries the detail.
 */
export function MonthGrid({
  month,
  selected,
  events,
  onSelect,
}: {
  /** Any date within the month to display. */
  month: Date;
  selected: Date;
  events: ApiCalendarEvent[];
  onSelect: (day: Date) => void;
}) {
  const { cells, countsByDay } = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // back up to the Sunday on/before the 1st

    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }

    const counts = new Map<string, number>();
    for (const e of events) {
      const k = dayKey(e.start);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return { cells: out, countsByDay: counts };
  }, [month, events]);

  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(selected);

  return (
    <View style={styles.wrap}>
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={`${w}${i}`} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((d) => {
          const k = dayKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = k === todayKey;
          const isSelected = k === selectedKey;
          const count = countsByDay.get(k) ?? 0;
          return (
            <Pressable
              key={k}
              style={styles.cell}
              onPress={() => onSelect(d)}
              hitSlop={2}
            >
              <View style={[styles.dayCircle, isSelected && styles.daySelected]}>
                <Text
                  style={[
                    styles.dayText,
                    !inMonth && styles.dayMuted,
                    isToday && !isSelected && styles.dayToday,
                    isSelected && styles.dayTextSelected,
                  ]}
                >
                  {d.getDate()}
                </Text>
              </View>
              <View style={styles.dots}>
                {count > 0
                  ? Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                      <View
                        key={i}
                        style={[styles.dot, isSelected && styles.dotSelected]}
                      />
                    ))
                  : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingBottom: 6 },
  weekRow: { flexDirection: "row", paddingBottom: 4 },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 2,
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  daySelected: { backgroundColor: "#111827" },
  dayText: { fontSize: 15, color: "#111827" },
  dayMuted: { color: "#d1d5db" },
  dayToday: { color: "#2563eb", fontWeight: "700" },
  dayTextSelected: { color: "#ffffff", fontWeight: "600" },
  dots: { flexDirection: "row", gap: 2, height: 6, alignItems: "center" },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#2563eb",
  },
  dotSelected: { backgroundColor: "#111827" },
});
