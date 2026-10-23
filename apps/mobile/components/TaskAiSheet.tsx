import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AiLoader } from "./AiLoader";
import { Markdown } from "./ai/Markdown";
import { apiFetch } from "../lib/api";
import {
  streamPanelBot,
  toLegacyTurns,
  type UiAssistantMessage,
  type UiPanelMessage,
} from "../lib/ui-stream";

/**
 * "Ask AI about this task" — mobile twin of web's `task-ai-panel.tsx`. Same
 * route (`POST /api/properties/:id/tasks/:taskId/ai`, Bearer), same streamed
 * UI-message protocol, rendered inline on the task detail screen: tool
 * activity while it reads the task, then the answer streaming in. Thumbs
 * feed the learning loop. The transcript lives in component state; task
 * conversations are short and scoped.
 */
const TOOL_LABELS: Record<string, string> = {
  get_task_details: "Reading the task",
  get_subtasks: "Checking sub-tasks",
  get_related_tasks: "Checking related tasks",
  property__search: "Searching memory",
  property__remember: "Saving to memory",
  delegate_task: "Handing off to an agent",
};

const SUGGESTIONS = ["What's left on this?", "Who's blocked?", "Suggest next steps"];

export function TaskAiSheet({ propertyId, taskId }: { propertyId: string; taskId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiPanelMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setError(null);
    seqRef.current += 1;
    const user: UiPanelMessage = { id: `u-${seqRef.current}`, role: "user", text: question };
    const history = [...messages, user];
    setMessages(history);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let placeholderId: string | null = null;
    try {
      await streamPanelBot(
        `/api/properties/${propertyId}/tasks/${taskId}/ai`,
        { messages: toLegacyTurns(history) },
        (partial) => {
          placeholderId = partial.id;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === partial.id);
            if (idx < 0) return [...prev, partial];
            const next = [...prev];
            next[idx] = partial;
            return next;
          });
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "Couldn't reach the task assistant");
        // Roll back so a retry doesn't duplicate the question.
        setMessages((prev) => prev.filter((m) => m.id !== user.id && m.id !== placeholderId));
        setInput(question);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable style={styles.launcher} onPress={() => setOpen(true)}>
        <Ionicons name="sparkles-outline" size={15} color="#6b7280" />
        <Text style={styles.launcherText}>Ask AI about this task</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Ionicons name="sparkles" size={14} color="#111827" />
        <Text style={styles.headerText}>Task assistant</Text>
        <View style={{ flex: 1 }} />
        <Pressable hitSlop={8} onPress={() => setOpen(false)}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>

      {messages.length === 0 ? (
        <View style={styles.chips}>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} style={styles.chip} onPress={() => void send(s)}>
              <Text style={styles.chipText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.transcript}>
        {messages.map((m, i) =>
          m.role === "user" ? (
            <View key={m.id} style={styles.userRow}>
              <View style={styles.userBubble}>
                <Text style={styles.userText}>{m.text}</Text>
              </View>
            </View>
          ) : (
            <AssistantBlock
              key={m.id}
              message={m}
              live={busy && i === messages.length - 1}
              propertyId={propertyId}
              taskId={taskId}
            />
          ),
        )}
        {busy && (!messages.length || messages[messages.length - 1].role === "user") ? (
          <AiLoader label="Reading the task…" />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="What does this involve? Who's blocked?…"
          placeholderTextColor="#9ca3af"
          style={styles.input}
          editable={!busy}
          multiline
          onSubmitEditing={() => void send(input)}
          blurOnSubmit
        />
        {busy ? (
          <Pressable
            style={styles.sendButton}
            onPress={() => abortRef.current?.abort()}
            accessibilityLabel="Stop"
          >
            <Ionicons name="stop" size={16} color="#ffffff" />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendButton, !input.trim() && styles.disabled]}
            disabled={!input.trim()}
            onPress={() => void send(input)}
            accessibilityLabel="Ask"
          >
            <Ionicons name="arrow-up" size={16} color="#ffffff" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function AssistantBlock({
  message,
  live,
  propertyId,
  taskId,
}: {
  message: UiAssistantMessage;
  live: boolean;
  propertyId: string;
  taskId: string;
}) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const rate = async (value: 1 | -1) => {
    setRating(value);
    try {
      await apiFetch(`/api/properties/${propertyId}/ai-feedback`, {
        method: "POST",
        body: {
          surface: "task",
          sessionId: taskId,
          messageKey: message.id,
          rating: value,
          excerpt: message.text.slice(0, 600),
        },
      });
    } catch {
      // best-effort
    }
  };
  return (
    <View style={styles.assistant}>
      {message.tools.length > 0 ? (
        <View style={styles.toolRail}>
          {message.tools.map((t) => (
            <View key={t.toolCallId} style={styles.toolRow}>
              <Ionicons
                name={
                  t.state === "output-available"
                    ? "checkmark"
                    : t.state === "output-error"
                      ? "alert-circle-outline"
                      : "ellipse-outline"
                }
                size={12}
                color="#9ca3af"
              />
              <Text style={styles.toolText}>
                {TOOL_LABELS[t.toolName] ?? t.toolName.replace(/_/g, " ")}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {message.text ? <Markdown size={14}>{message.text}</Markdown> : null}
      {message.error ? <Text style={styles.error}>{message.error}</Text> : null}
      {message.text && !live ? (
        <View style={styles.feedbackRow}>
          <Pressable hitSlop={8} onPress={() => void rate(1)}>
            <Ionicons
              name={rating === 1 ? "thumbs-up" : "thumbs-up-outline"}
              size={14}
              color={rating === 1 ? "#15803d" : "#9ca3af"}
            />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => void rate(-1)}>
            <Ionicons
              name={rating === -1 ? "thumbs-down" : "thumbs-down-outline"}
              size={14}
              color={rating === -1 ? "#b91c1c" : "#9ca3af"}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  launcher: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  launcherText: { fontSize: 14, color: "#6b7280", fontWeight: "500" },
  sheet: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: "#f9fafb",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    padding: 12,
    gap: 10,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerText: { fontSize: 14, fontWeight: "600", color: "#111827" },
  close: { fontSize: 13, color: "#6b7280" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  chipText: { fontSize: 13, color: "#111827" },
  transcript: { gap: 12 },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBubble: {
    maxWidth: "85%",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  userText: { fontSize: 14, lineHeight: 20, color: "#111827" },
  assistant: { gap: 8 },
  toolRail: { gap: 3 },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolText: { fontSize: 12, color: "#6b7280" },
  feedbackRow: { flexDirection: "row", gap: 12, paddingTop: 2 },
  error: { fontSize: 13, color: "#b91c1c" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.35 },
});
