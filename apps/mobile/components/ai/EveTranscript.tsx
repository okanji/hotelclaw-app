import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  displayUserText,
  renderedSpecs,
  type AssistantItem,
  type InputRequest,
  type ToolCall,
  type TranscriptItem,
} from "@hotelclaw/chat-ui/transcript";
import { AiUiAttachment } from "../attachments/AiUiAttachment";
import { AiLoader } from "../AiLoader";
import { apiFetch } from "../../lib/api";
import { Markdown } from "./Markdown";

/**
 * Mobile renderer for an eve transcript — the phone twin of web's
 * `components/ai/eve-conversation.tsx` over the SAME reducer items. User
 * bubbles, assistant markdown, collapsed tool activity ("Used N tools"),
 * render_ui cards through the existing `AiUiAttachment`, parked questions
 * (option chips / free text) and approvals (Approve / Cancel), and 👍/👎
 * that feed the learning loop via `/api/properties/:id/ai-feedback`.
 *
 * Rendered INSIDE the caller's scroll view (a FlatList inverted trick isn't
 * worth it for a transcript that is rebuilt whole on every event).
 */
const TOOL_LABELS: Record<string, string> = {
  render_ui: "Drawing a view",
  search_tasks: "Searching tasks",
  list_documents: "Listing documents",
  read_document: "Reading a document",
  create_task: "Creating a task",
  update_task: "Updating a task",
  list_meetings: "Checking the calendar",
  list_bookings: "Checking bookings",
  search_chat_messages: "Searching chat",
  property__search: "Searching memory",
  property__remember: "Saving to memory",
  person__remember: "Noting your preference",
  person__search: "Checking your notes",
  web_search: "Searching the web",
  web_fetch: "Reading a page",
};

function labelFor(name: string) {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

export function EveTranscript({
  items,
  busy,
  resuming,
  propertyId,
  surface,
  sessionId,
  onRespond,
  workingLabel = "Working on it…",
}: {
  items: TranscriptItem[];
  busy: boolean;
  resuming: boolean;
  propertyId: string;
  surface: "assistant" | "agent" | "channel";
  sessionId: string | null;
  onRespond?: (requestId: string, answer: { optionId?: string; text?: string }) => void;
  workingLabel?: string;
}) {
  return (
    <View style={styles.list}>
      {items.map((item, index) =>
        item.kind === "user" ? (
          <View key={index} style={styles.userRow}>
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{displayUserText(item.text)}</Text>
            </View>
          </View>
        ) : (
          <AssistantTurn
            key={index}
            item={item}
            live={index === items.length - 1 && (busy || item.streaming)}
            propertyId={propertyId}
            surface={surface}
            sessionId={sessionId}
            messageKey={`turn-${index}`}
            onRespond={onRespond}
          />
        ),
      )}
      {busy || resuming ? (
        <View style={styles.loader}>
          <AiLoader label={resuming ? "Loading this conversation…" : workingLabel} />
        </View>
      ) : null}
    </View>
  );
}

function AssistantTurn({
  item,
  live,
  propertyId,
  surface,
  sessionId,
  messageKey,
  onRespond,
}: {
  item: AssistantItem;
  live: boolean;
  propertyId: string;
  surface: "assistant" | "agent" | "channel";
  sessionId: string | null;
  messageKey: string;
  onRespond?: (requestId: string, answer: { optionId?: string; text?: string }) => void;
}) {
  const specs = useMemo(() => renderedSpecs(item.toolCalls), [item.toolCalls]);
  const hasText = Boolean(item.text.trim());
  return (
    <View style={styles.assistant}>
      {item.toolCalls.length > 0 ? <ToolActivity calls={item.toolCalls} /> : null}
      {specs.map((entry) => (
        <AiUiAttachment
          key={entry.callId}
          attachment={{ type: "ai_ui", spec: entry.spec } as never}
        />
      ))}
      {hasText ? <Markdown>{item.text}</Markdown> : null}
      {item.requests.map((request) => (
        <RequestCard key={request.requestId} request={request} onRespond={onRespond} />
      ))}
      {item.failure ? (
        <Text style={styles.failure}>{item.failure.message || "That turn failed."}</Text>
      ) : null}
      {hasText && !live ? (
        <Feedback
          propertyId={propertyId}
          surface={surface}
          sessionId={sessionId}
          messageKey={messageKey}
          excerpt={item.text.slice(0, 600)}
        />
      ) : null}
    </View>
  );
}

function ToolActivity({ calls }: { calls: ToolCall[] }) {
  const working = calls.some((c) => !c.done);
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        style={styles.toolHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Ionicons name="sparkles-outline" size={13} color={working ? "#6b7280" : "#9ca3af"} />
        <Text style={styles.toolHeaderText}>
          {working ? "Working…" : `Used ${calls.length} tool${calls.length === 1 ? "" : "s"}`}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={12} color="#9ca3af" />
      </Pressable>
      {open || working ? (
        <View style={styles.toolRail}>
          {calls.map((call) => (
            <View key={call.callId} style={styles.toolRow}>
              <Ionicons
                name={call.done ? (call.error ? "alert-circle-outline" : "checkmark") : "ellipse-outline"}
                size={12}
                color={call.error ? "#b45309" : "#9ca3af"}
              />
              <Text style={[styles.toolRowText, !call.done && styles.toolRowLive]} numberOfLines={1}>
                {labelFor(call.toolName)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RequestCard({
  request,
  onRespond,
}: {
  request: InputRequest;
  onRespond?: (requestId: string, answer: { optionId?: string; text?: string }) => void;
}) {
  const [text, setText] = useState("");
  const isApproval = request.kind === "tool-approval";
  const title = isApproval
    ? `Approve: ${request.action ? labelFor(request.action.toolName) : "this action"}`
    : request.prompt || "The assistant has a question";

  if (request.outcome) {
    const chosen = request.options.find((o) => o.id === request.answer)?.label ?? request.answer;
    return (
      <Text style={styles.settled}>
        <Text style={styles.settledTitle}>{title}</Text>
        {" — "}
        {chosen ? `you chose "${chosen}"` : request.outcome}
      </Text>
    );
  }
  const options =
    request.options.length > 0
      ? request.options
      : isApproval
        ? [
            { id: "approve", label: "Approve", description: null },
            { id: "cancel", label: "Cancel", description: null },
          ]
        : [];
  return (
    <View style={[styles.card, isApproval && styles.cardApproval]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {isApproval && request.prompt ? <Text style={styles.cardBody}>{request.prompt}</Text> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const primary = isApproval && /approve|yes|allow/i.test(option.id);
          return (
            <Pressable
              key={option.id}
              disabled={!onRespond}
              onPress={() => onRespond?.(request.requestId, { optionId: option.id })}
              style={[styles.chip, primary && styles.chipPrimary]}
            >
              <Text style={[styles.chipText, primary && styles.chipTextPrimary]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {!isApproval && (request.allowFreeform || options.length === 0) ? (
        <View style={styles.answerRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type an answer…"
            placeholderTextColor="#9ca3af"
            style={styles.answerInput}
            editable={Boolean(onRespond)}
          />
          <Pressable
            disabled={!text.trim() || !onRespond}
            onPress={() => {
              onRespond?.(request.requestId, { text: text.trim() });
              setText("");
            }}
            style={[styles.chip, styles.chipPrimary, !text.trim() && styles.disabled]}
          >
            <Text style={styles.chipTextPrimary}>Answer</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Feedback({
  propertyId,
  surface,
  sessionId,
  messageKey,
  excerpt,
}: {
  propertyId: string;
  surface: "assistant" | "agent" | "channel";
  sessionId: string | null;
  messageKey: string;
  excerpt: string;
}) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = async (value: 1 | -1, withNote?: string) => {
    setRating(value);
    if (value === -1 && withNote === undefined) setNoteOpen(true);
    try {
      await apiFetch(`/api/properties/${propertyId}/ai-feedback`, {
        method: "POST",
        body: { surface, sessionId, messageKey, rating: value, note: withNote, excerpt },
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
    <View style={styles.feedback}>
      <View style={styles.feedbackRow}>
        <Pressable hitSlop={8} onPress={() => void submit(1)} style={styles.iconButton}>
          <Ionicons
            name={rating === 1 ? "thumbs-up" : "thumbs-up-outline"}
            size={15}
            color={rating === 1 ? "#15803d" : "#9ca3af"}
          />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => void submit(-1)} style={styles.iconButton}>
          <Ionicons
            name={rating === -1 ? "thumbs-down" : "thumbs-down-outline"}
            size={15}
            color={rating === -1 ? "#b91c1c" : "#9ca3af"}
          />
        </Pressable>
        {saved ? <Text style={styles.savedText}>{"Saved — I'll remember that."}</Text> : null}
      </View>
      {noteOpen ? (
        <View style={styles.answerRow}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What should it have done? (saved as a preference)"
            placeholderTextColor="#9ca3af"
            style={styles.answerInput}
            autoFocus
          />
          <Pressable
            disabled={!note.trim()}
            onPress={() => void submit(-1, note.trim())}
            style={[styles.chip, styles.chipPrimary, !note.trim() && styles.disabled]}
          >
            <Text style={styles.chipTextPrimary}>Save</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 18, paddingHorizontal: 16, paddingVertical: 14 },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBubble: {
    maxWidth: "85%",
    backgroundColor: "#f3f4f6",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  userText: { fontSize: 15, lineHeight: 21, color: "#111827" },
  assistant: { gap: 10 },
  loader: { paddingVertical: 4 },
  toolHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  toolHeaderText: { fontSize: 13, color: "#6b7280", fontWeight: "500" },
  toolRail: {
    marginTop: 4,
    marginLeft: 6,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "#e5e7eb",
    paddingLeft: 10,
    gap: 4,
  },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolRowText: { fontSize: 13, color: "#6b7280", flex: 1 },
  toolRowLive: { color: "#111827" },
  settled: { fontSize: 13, color: "#6b7280" },
  settledTitle: { color: "#111827", fontWeight: "500" },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    gap: 10,
    backgroundColor: "#ffffff",
  },
  cardApproval: { backgroundColor: "#fffbeb", borderColor: "#fcd34d" },
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#111827" },
  cardBody: { fontSize: 13, color: "#6b7280" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  chipPrimary: { backgroundColor: "#111827" },
  chipText: { fontSize: 13, color: "#111827", fontWeight: "500" },
  chipTextPrimary: { fontSize: 13, color: "#ffffff", fontWeight: "600" },
  disabled: { opacity: 0.4 },
  answerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  answerInput: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#111827",
  },
  failure: { fontSize: 13, color: "#b91c1c" },
  feedback: { gap: 8 },
  feedbackRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconButton: { padding: 4 },
  savedText: { fontSize: 12, color: "#6b7280", marginLeft: 6 },
});
