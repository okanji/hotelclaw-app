import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch } from "../../lib/api";

/**
 * The actions under an AI reply — the phone twin of the web's `ReplyActions`
 * (the shadcn/ui AI Elements "Message" pattern's footer): Copy that swaps to
 * a check for two seconds, Good / Bad response as toggles, and on a 👎 a
 * one-line note, because the note is what the nightly distiller turns into
 * a durable preference. Feedback posts to `/api/properties/:id/ai-feedback`
 * (Bearer) — the learning loop's mobile door.
 */
export type ReplyFeedbackScope = {
  propertyId: string;
  surface: "assistant" | "agent" | "channel" | "task";
  sessionId: string | null;
};

export function ReplyActions({
  text,
  messageKey,
  feedback,
  children,
}: {
  text: string;
  messageKey: string;
  /** When null, only Copy renders. */
  feedback: ReplyFeedbackScope | null;
  /** Extra footer items — the context meter. */
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // best-effort
    }
  };

  const rate = async (value: 1 | -1, withNote?: string) => {
    if (!feedback) return;
    const next = rating === value && withNote === undefined ? null : value;
    setRating(next);
    if (next === null) {
      setNoteOpen(false);
      return;
    }
    if (value === -1 && withNote === undefined) setNoteOpen(true);
    try {
      await apiFetch(`/api/properties/${feedback.propertyId}/ai-feedback`, {
        method: "POST",
        body: {
          surface: feedback.surface,
          sessionId: feedback.sessionId,
          messageKey,
          rating: value,
          note: withNote,
          excerpt: text.slice(0, 600),
        },
      });
      if (withNote !== undefined) {
        setNoteOpen(false);
        setSaved(true);
      }
    } catch {
      // Feedback is best-effort.
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          hitSlop={8}
          onPress={() => void copy()}
          style={styles.iconButton}
          accessibilityLabel={copied ? "Copied" : "Copy"}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={15}
            color={copied ? "#15803d" : "#9ca3af"}
          />
        </Pressable>
        {feedback ? (
          <>
            <Pressable
              hitSlop={8}
              onPress={() => void rate(1)}
              style={styles.iconButton}
              accessibilityLabel="Good response"
              accessibilityState={{ selected: rating === 1 }}
            >
              <Ionicons
                name={rating === 1 ? "thumbs-up" : "thumbs-up-outline"}
                size={15}
                color={rating === 1 ? "#15803d" : "#9ca3af"}
              />
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() => void rate(-1)}
              style={styles.iconButton}
              accessibilityLabel="Bad response"
              accessibilityState={{ selected: rating === -1 }}
            >
              <Ionicons
                name={rating === -1 ? "thumbs-down" : "thumbs-down-outline"}
                size={15}
                color={rating === -1 ? "#b91c1c" : "#9ca3af"}
              />
            </Pressable>
          </>
        ) : null}
        {children ? <View style={styles.extra}>{children}</View> : null}
      </View>
      {/* Its own line, not a flex item in the icon row: a long Text in a
          wrapping row is measured at the row's full width and then placed
          after the icons, so it ran past the bubble edge and got clipped. */}
      {saved ? <Text style={styles.savedText}>{"Saved — I'll remember that."}</Text> : null}
      {noteOpen ? (
        <View style={styles.noteRow}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What should it have done? (saved as a preference)"
            placeholderTextColor="#9ca3af"
            style={styles.noteInput}
            autoFocus
            onSubmitEditing={() => void rate(-1, note.trim())}
            returnKeyType="done"
          />
          <Pressable
            disabled={!note.trim()}
            onPress={() => void rate(-1, note.trim())}
            style={[styles.saveButton, !note.trim() && styles.disabled]}
          >
            <Text style={styles.saveText}>Save</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setNoteOpen(false)} accessibilityLabel="Dismiss">
            <Ionicons name="close" size={16} color="#9ca3af" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", gap: 2, flexWrap: "wrap" },
  iconButton: { padding: 4 },
  extra: { marginLeft: 6 },
  savedText: { fontSize: 12, color: "#6b7280", paddingHorizontal: 4 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  noteInput: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#111827",
  },
  saveButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#111827",
  },
  saveText: { fontSize: 13, color: "#ffffff", fontWeight: "600" },
  disabled: { opacity: 0.4 },
});
