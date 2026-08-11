import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { apiFetch, type ApiCalendarEvent, type ApiMeeting } from "../lib/api";
import { timeOfDay } from "./ui";

const SOURCE_LABEL: Record<ApiCalendarEvent["source"], string> = {
  meeting: "Meeting",
  task: "Scheduled task",
  booking: "Booking",
  external: "External calendar",
};

function whenLabel(event: ApiCalendarEvent): string {
  const day = new Date(event.start).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  if (event.all_day) return `${day} · All day`;
  return `${day} · ${timeOfDay(event.start)} – ${timeOfDay(event.end)}`;
}

/**
 * Read view for any calendar entry, with edit/delete only for meetings —
 * scheduled tasks, bookings and events synced from a connected external
 * calendar are owned by other surfaces and must not be editable here.
 */
export function EventDetailSheet({
  event,
  propertyId,
  onClose,
  onEdit,
  onDeleted,
}: {
  event: ApiCalendarEvent | null;
  propertyId: string | undefined;
  onClose: () => void;
  onEdit: (meeting: ApiMeeting) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!event) return null;
  const editable = event.source === "meeting" && !!propertyId;

  const loadMeeting = async (): Promise<ApiMeeting | null> => {
    if (!propertyId) return null;
    return apiFetch<ApiMeeting>(
      `/api/properties/${propertyId}/meetings/${event.id}`,
    );
  };

  const handleEdit = async () => {
    setBusy(true);
    setError(null);
    try {
      const meeting = await loadMeeting();
      if (meeting) onEdit(meeting);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    Alert.alert("Delete event?", `"${event.title}" will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await apiFetch(
              `/api/properties/${propertyId}/meetings/${event.id}`,
              { method: "DELETE" },
            );
            onDeleted();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Modal
      visible={!!event}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
          {editable ? (
            <Pressable onPress={handleEdit} hitSlop={10} disabled={busy}>
              <Text style={[styles.edit, busy && styles.disabled]}>Edit</Text>
            </Pressable>
          ) : (
            <View />
          )}
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{event.title}</Text>
          <Text style={styles.when}>{whenLabel(event)}</Text>
          <Text style={styles.kind}>{SOURCE_LABEL[event.source]}</Text>

          {event.location ? (
            <Field label="Location" value={event.location} />
          ) : null}
          {event.description ? (
            <Field label="Notes" value={event.description} />
          ) : null}

          {!editable ? (
            <Text style={styles.note}>
              {event.source === "task"
                ? "Open it in Tasks to make changes."
                : event.source === "booking"
                  ? "Bookings are managed on the web app."
                  : "This event comes from a connected calendar."}
            </Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy ? <ActivityIndicator style={styles.spinner} /> : null}

          {editable ? (
            <Pressable
              style={styles.delete}
              onPress={handleDelete}
              disabled={busy}
            >
              <Text style={styles.deleteText}>Delete event</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
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
  close: { fontSize: 16, color: "#6b7280" },
  edit: { fontSize: 16, fontWeight: "600", color: "#2563eb" },
  disabled: { color: "#9ca3af" },
  content: { padding: 20, paddingBottom: 60, gap: 10 },
  title: { fontSize: 24, fontWeight: "700" },
  when: { fontSize: 16, color: "#374151" },
  kind: { fontSize: 13, color: "#6b7280" },
  field: { marginTop: 12, gap: 3 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fieldValue: { fontSize: 16, color: "#111827", lineHeight: 23 },
  note: { marginTop: 16, fontSize: 14, color: "#6b7280" },
  error: { color: "#dc2626", fontSize: 14, marginTop: 12 },
  spinner: { marginTop: 12 },
  delete: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
  },
  deleteText: { color: "#dc2626", fontSize: 16, fontWeight: "600" },
});
