import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiFetch, type ApiMeeting, type SaveMeetingBody } from "../lib/api";

function roundToNextHalfHour(d = new Date()): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  out.setMinutes(out.getMinutes() > 30 ? 60 : 30);
  return out;
}

/**
 * Create / edit a calendar event. Posts to the meetings REST routes, which run
 * the same `saveMeetingFor` as the web event dialog — so organizer handling and
 * attendee syncing are identical.
 */
export function EventFormSheet({
  visible,
  propertyId,
  meeting,
  initialDate,
  onClose,
  onSaved,
}: {
  visible: boolean;
  propertyId: string | undefined;
  /** Present = edit, absent = create. */
  meeting?: ApiMeeting | null;
  initialDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState<Date>(roundToNextHalfHour());
  const [end, setEnd] = useState<Date>(
    new Date(roundToNextHalfHour().getTime() + 30 * 60000),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the sheet opens, so a create never inherits the last edit.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (meeting) {
      setTitle(meeting.title ?? "");
      setLocation(meeting.location ?? "");
      setDescription(meeting.description ?? "");
      setAllDay(meeting.all_day);
      const s = meeting.scheduled_start
        ? new Date(meeting.scheduled_start)
        : roundToNextHalfHour();
      const e = meeting.scheduled_end
        ? new Date(meeting.scheduled_end)
        : new Date(s.getTime() + 30 * 60000);
      setStart(s);
      setEnd(e);
    } else {
      const base = initialDate ? new Date(initialDate) : new Date();
      const now = new Date();
      base.setHours(now.getHours(), now.getMinutes(), 0, 0);
      const s = roundToNextHalfHour(base);
      setTitle("");
      setLocation("");
      setDescription("");
      setAllDay(false);
      setStart(s);
      setEnd(new Date(s.getTime() + 30 * 60000));
    }
  }, [visible, meeting, initialDate]);

  // Keep end after start — dragging start past end otherwise produces a
  // validation error from the server instead of doing the obvious thing.
  const updateStart = (next: Date) => {
    setStart(next);
    if (end.getTime() <= next.getTime()) {
      setEnd(new Date(next.getTime() + 30 * 60000));
    }
  };

  const submit = async () => {
    if (!propertyId || saving) return;
    if (!title.trim()) {
      setError("Give the event a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const body: SaveMeetingBody = {
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay,
      attendeeIds: meeting?.attendees.map((a) => a.user_id) ?? [],
      withVideoCall: meeting ? meeting.stream_call_type === "default" : false,
    };
    try {
      if (meeting) {
        await apiFetch(
          `/api/properties/${propertyId}/meetings/${meeting.id}`,
          { method: "PATCH", body },
        );
      } else {
        await apiFetch(`/api/properties/${propertyId}/meetings`, {
          method: "POST",
          body,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.barTitle}>
            {meeting ? "Edit event" : "New event"}
          </Text>
          <Pressable onPress={submit} hitSlop={10} disabled={saving}>
            <Text style={[styles.save, saving && styles.disabled]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <TextInput
            style={styles.titleInput}
            placeholder="Title"
            placeholderTextColor="#9ca3af"
            value={title}
            onChangeText={setTitle}
            autoFocus={!meeting}
          />
          <TextInput
            style={styles.input}
            placeholder="Location"
            placeholderTextColor="#9ca3af"
            value={location}
            onChangeText={setLocation}
          />

          <View style={styles.rowBetween}>
            <Text style={styles.label}>All-day</Text>
            <Switch value={allDay} onValueChange={setAllDay} />
          </View>

          <View style={styles.pickerRow}>
            <Text style={styles.label}>Starts</Text>
            <View style={styles.pickers}>
              <DateTimePicker
                value={start}
                mode="date"
                onChange={(_, d) => d && updateStart(d)}
              />
              {!allDay ? (
                <DateTimePicker
                  value={start}
                  mode="time"
                  onChange={(_, d) => d && updateStart(d)}
                />
              ) : null}
            </View>
          </View>

          <View style={styles.pickerRow}>
            <Text style={styles.label}>Ends</Text>
            <View style={styles.pickers}>
              <DateTimePicker
                value={end}
                mode="date"
                onChange={(_, d) => d && setEnd(d)}
              />
              {!allDay ? (
                <DateTimePicker
                  value={end}
                  mode="time"
                  onChange={(_, d) => d && setEnd(d)}
                />
              ) : null}
            </View>
          </View>

          <TextInput
            style={styles.notes}
            placeholder="Notes"
            placeholderTextColor="#9ca3af"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: "#ffffff" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  barTitle: { fontSize: 16, fontWeight: "600" },
  cancel: { fontSize: 16, color: "#6b7280" },
  save: { fontSize: 16, fontWeight: "600", color: "#2563eb" },
  disabled: { color: "#9ca3af" },
  content: { padding: 16, paddingBottom: 60, gap: 14 },
  titleInput: {
    fontSize: 20,
    fontWeight: "600",
    paddingVertical: 8,
    color: "#111827",
  },
  input: {
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    color: "#111827",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  pickerRow: { gap: 6 },
  pickers: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    // iOS renders compact pickers as pills; keep them left-aligned.
    justifyContent: Platform.OS === "ios" ? "flex-start" : "space-between",
  },
  label: { fontSize: 15, fontWeight: "500", color: "#374151" },
  notes: {
    fontSize: 16,
    minHeight: 90,
    textAlignVertical: "top",
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    color: "#111827",
  },
  error: { color: "#dc2626", fontSize: 14 },
});
