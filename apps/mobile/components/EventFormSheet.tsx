import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useState } from "react";
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
import { SheetSurface } from "./ui";

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
 *
 * The form body only mounts while the sheet is open, so every open starts from
 * a fresh initial state (a create never inherits the last edit) without any
 * reset-on-open effect.
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
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {visible ? (
        <EventFormBody
          propertyId={propertyId}
          meeting={meeting}
          initialDate={initialDate}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Modal>
  );
}

/**
 * One date-or-time picker control. iOS renders the system's inline compact
 * picker. Android's picker is a modal dialog, not a view — rendering it
 * inline mounts the dialog immediately, so Android shows a tappable value
 * chip and opens the dialog on demand instead.
 */
function PickerField({
  value,
  mode,
  onChange,
}: {
  value: Date;
  mode: "date" | "time";
  onChange: (next: Date) => void;
}) {
  const [open, setOpen] = useState(false);

  if (Platform.OS === "ios") {
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        onChange={(_, d) => d && onChange(d)}
      />
    );
  }

  return (
    <>
      <Pressable style={androidPickerStyles.chip} onPress={() => setOpen(true)}>
        <Text style={androidPickerStyles.chipText}>
          {mode === "date"
            ? value.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : value.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
        </Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={value}
          mode={mode}
          onChange={(event, d) => {
            setOpen(false);
            if (event.type === "set" && d) onChange(d);
          }}
        />
      ) : null}
    </>
  );
}

const androidPickerStyles = StyleSheet.create({
  chip: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontSize: 15, color: "#111827", fontWeight: "500" },
});

function initialWindow(
  meeting: ApiMeeting | null | undefined,
  initialDate: Date | undefined,
): { start: Date; end: Date } {
  if (meeting) {
    const start = meeting.scheduled_start
      ? new Date(meeting.scheduled_start)
      : roundToNextHalfHour();
    const end = meeting.scheduled_end
      ? new Date(meeting.scheduled_end)
      : new Date(start.getTime() + 30 * 60000);
    return { start, end };
  }
  const base = initialDate ? new Date(initialDate) : new Date();
  const now = new Date();
  base.setHours(now.getHours(), now.getMinutes(), 0, 0);
  const start = roundToNextHalfHour(base);
  return { start, end: new Date(start.getTime() + 30 * 60000) };
}

function EventFormBody({
  propertyId,
  meeting,
  initialDate,
  onClose,
  onSaved,
}: {
  propertyId: string | undefined;
  meeting?: ApiMeeting | null;
  initialDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(meeting?.title ?? "");
  const [location, setLocation] = useState(meeting?.location ?? "");
  const [description, setDescription] = useState(meeting?.description ?? "");
  const [allDay, setAllDay] = useState(meeting?.all_day ?? false);
  const [initial] = useState(() => initialWindow(meeting, initialDate));
  const [start, setStart] = useState<Date>(initial.start);
  const [end, setEnd] = useState<Date>(initial.end);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the window ordered from either direction — dragging start past end
  // (or end before start) otherwise produces a server validation error
  // instead of doing the obvious thing.
  const updateStart = (next: Date) => {
    setStart(next);
    if (end.getTime() <= next.getTime()) {
      setEnd(new Date(next.getTime() + 30 * 60000));
    }
  };
  const updateEnd = (next: Date) => {
    setEnd(next);
    if (next.getTime() <= start.getTime()) {
      setStart(new Date(next.getTime() - 30 * 60000));
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
    <SheetSurface>
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
            <PickerField value={start} mode="date" onChange={updateStart} />
            {!allDay ? (
              <PickerField value={start} mode="time" onChange={updateStart} />
            ) : null}
          </View>
        </View>

        <View style={styles.pickerRow}>
          <Text style={styles.label}>Ends</Text>
          <View style={styles.pickers}>
            <PickerField value={end} mode="date" onChange={updateEnd} />
            {!allDay ? (
              <PickerField value={end} mode="time" onChange={updateEnd} />
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
    </SheetSurface>
  );
}

const styles = StyleSheet.create({
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
