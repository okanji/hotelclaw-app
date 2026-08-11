import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { EventDetailSheet } from "../../components/EventDetailSheet";
import { EventFormSheet } from "../../components/EventFormSheet";
import { MonthGrid, dayKey } from "../../components/MonthGrid";
import { initialsFor, ScreenHeader } from "../../components/ScreenHeader";
import {
  EmptyState,
  ErrorState,
  Loading,
  dayHeading,
  timeOfDay,
} from "../../components/ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePropertyContext } from "../../contexts/PropertyContext";
import {
  useApi,
  type ApiCalendarEvent,
  type ApiMeeting,
  type CalendarSource,
} from "../../lib/api";

type ViewMode = "month" | "list";

/** How far the list view looks ahead. Month view fetches its own window. */
const LIST_DAYS = 60;

const SOURCE_COLOR: Record<CalendarSource, string> = {
  meeting: "#2563eb",
  task: "#7c3aed",
  booking: "#8b5cf6",
  external: "#6b7280",
};

const SOURCE_LABEL: Record<CalendarSource, string> = {
  meeting: "Meeting",
  task: "Task",
  booking: "Booking",
  external: "External",
};

export default function CalendarTab() {
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;
  const name = activeProperty?.property.name;

  const [mode, setMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [detail, setDetail] = useState<ApiCalendarEvent | null>(null);
  const [editing, setEditing] = useState<ApiMeeting | null>(null);
  const [composing, setComposing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // One window covers both modes: the displayed month, widened to the list
  // horizon, so switching modes never refetches.
  const { from, to } = useMemo(() => {
    const start = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    start.setDate(start.getDate() - 7);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const listEnd = new Date(today);
    listEnd.setDate(listEnd.getDate() + LIST_DAYS);
    const monthEnd = new Date(
      monthAnchor.getFullYear(),
      monthAnchor.getMonth() + 1,
      7,
    );
    const end = monthEnd > listEnd ? monthEnd : listEnd;
    const begin = start < today ? start : today;
    return { from: begin.toISOString(), to: end.toISOString() };
  }, [monthAnchor]);

  const { data, loading, error, refetch } = useApi<ApiCalendarEvent[]>(
    propertyId
      ? `/api/properties/${propertyId}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      : null,
  );

  const events = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = [...(data ?? [])].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    if (!needle) return all;
    return all.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        (e.location ?? "").toLowerCase().includes(needle) ||
        (e.description ?? "").toLowerCase().includes(needle),
    );
  }, [data, search]);

  // List mode: every event from today forward, grouped by day.
  const sections = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDay = new Map<string, ApiCalendarEvent[]>();
    for (const e of events) {
      if (new Date(e.start) < today) continue;
      const k = dayKey(e.start);
      const list = byDay.get(k);
      if (list) list.push(e);
      else byDay.set(k, [e]);
    }
    return [...byDay.values()].map((list) => ({
      title: dayHeading(list[0].start),
      data: list,
    }));
  }, [events]);

  // Month mode: just the selected day.
  const daySections = useMemo(() => {
    const k = dayKey(selected);
    const list = events.filter((e) => dayKey(e.start) === k);
    return list.length
      ? [{ title: dayHeading(selected.toISOString()), data: list }]
      : [];
  }, [events, selected]);

  const shown = mode === "month" ? daySections : sections;

  const monthLabel = monthAnchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const shiftMonth = (delta: number) => {
    const next = new Date(
      monthAnchor.getFullYear(),
      monthAnchor.getMonth() + delta,
      1,
    );
    setMonthAnchor(next);
  };

  return (
    <View style={styles.container}>
      {searchOpen ? (
        // Apple collapses search behind an icon and expands it over the header
        // when tapped — the field only costs a row while it's being used.
        <SearchBar
          value={search}
          onChange={setSearch}
          onClose={() => {
            setSearchOpen(false);
            setSearch("");
          }}
        />
      ) : (
        <ScreenHeader
          title="Calendar"
          badgeLabel={name ? initialsFor(name) : undefined}
          accessory={
            <View style={styles.iconPill}>
              <Pressable
                onPress={() => setMode(mode === "list" ? "month" : "list")}
                hitSlop={6}
                style={styles.iconButton}
                accessibilityLabel={
                  mode === "list" ? "Switch to month view" : "Switch to list view"
                }
              >
                <Ionicons
                  name={mode === "list" ? "calendar-outline" : "list-outline"}
                  size={20}
                  color="#111827"
                />
              </Pressable>
              <Pressable
                onPress={() => setSearchOpen(true)}
                hitSlop={6}
                style={styles.iconButton}
                accessibilityLabel="Search events"
              >
                <Ionicons name="search" size={20} color="#111827" />
              </Pressable>
              {propertyId ? (
                <Pressable
                  onPress={() => {
                    setEditing(null);
                    setComposing(true);
                  }}
                  hitSlop={6}
                  style={styles.iconButton}
                  accessibilityLabel="New event"
                >
                  <Ionicons name="add" size={24} color="#111827" />
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}

      {mode === "month" ? (
        <View style={styles.monthBar}>
          <Text style={styles.monthTitle}>{monthLabel}</Text>
          <View style={styles.monthNav}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={10}>
              <Ionicons name="chevron-back" size={22} color="#374151" />
            </Pressable>
            <Pressable
              onPress={() => {
                const now = new Date();
                setMonthAnchor(now);
                setSelected(now);
              }}
              hitSlop={10}
              style={styles.todayButton}
            >
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={10}>
              <Ionicons name="chevron-forward" size={22} color="#374151" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {mode === "month" ? (
        <MonthGrid
          month={monthAnchor}
          selected={selected}
          events={events}
          onSelect={(d) => {
            setSelected(d);
            if (d.getMonth() !== monthAnchor.getMonth()) setMonthAnchor(d);
          }}
        />
      ) : null}

      {!propertyId ? (
        <EmptyState title="No property selected" />
      ) : loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={
            search
              ? "No matching events"
              : mode === "month"
                ? "Nothing on this day"
                : "Nothing scheduled"
          }
          body={
            search
              ? undefined
              : mode === "month"
                ? undefined
                : `No events in the next ${LIST_DAYS} days.`
          }
        />
      ) : (
        <SectionList
          sections={shown}
          keyExtractor={(item) => `${item.source}:${item.id}`}
          refreshing={loading}
          onRefresh={refetch}
          stickySectionHeadersEnabled={mode === "list"}
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayHeading}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.event, pressed && styles.pressed]}
              onPress={() => setDetail(item)}
            >
              <View
                style={[
                  styles.stripe,
                  { backgroundColor: SOURCE_COLOR[item.source] },
                ]}
              />
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.eventMeta}>
                  {item.all_day ? "All day" : timeOfDay(item.start)}
                  {" · "}
                  {SOURCE_LABEL[item.source]}
                  {item.location ? ` · ${item.location}` : ""}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <EventDetailSheet
        event={detail}
        propertyId={propertyId}
        onClose={() => setDetail(null)}
        onEdit={(meeting) => {
          setDetail(null);
          setEditing(meeting);
          setComposing(true);
        }}
        onDeleted={() => {
          setDetail(null);
          refetch();
        }}
      />

      <EventFormSheet
        visible={composing}
        propertyId={propertyId}
        meeting={editing}
        initialDate={mode === "month" ? selected : undefined}
        onClose={() => {
          setComposing(false);
          setEditing(null);
        }}
        onSaved={() => {
          setComposing(false);
          setEditing(null);
          refetch();
        }}
      />
    </View>
  );
}

function SearchBar({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.searchBar, { paddingTop: insets.top + 6 }]}>
      <View style={styles.searchField}>
        <Ionicons name="search" size={18} color="#9ca3af" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor="#9ca3af"
          value={value}
          onChangeText={onChange}
          autoFocus
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <Pressable onPress={onClose} hitSlop={10}>
        <Ionicons name="close-circle" size={26} color="#9ca3af" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  iconPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#f3f4f6",
    borderRadius: 999,
    paddingHorizontal: 4,
  },
  iconButton: { paddingHorizontal: 8, paddingVertical: 7 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  searchField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 16, color: "#111827" },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  monthTitle: { fontSize: 26, fontWeight: "700" },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 12 },
  todayButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  todayText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  dayHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f9fafb",
  },
  event: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  pressed: { backgroundColor: "#f9fafb" },
  stripe: { width: 3, borderRadius: 2 },
  eventBody: { flex: 1, gap: 3 },
  eventTitle: { fontSize: 16, fontWeight: "500" },
  eventMeta: { fontSize: 13, color: "#6b7280" },
});
