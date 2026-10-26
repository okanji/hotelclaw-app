import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  isAffirmativeOption,
  parkInputLines,
  parkOptions,
  parkOutcome,
  parkTitle,
  settledParkLabel,
  type ParkOption,
  type ParkRequest,
} from "@hotelclaw/chat-ui/turn";

/**
 * The controls for a turn parked on human input — the phone twin of
 * `apps/web/components/ai/agent-turn/park-controls.tsx`, over the same
 * `ParkRequest` shape and the same wording helpers:
 *  - Confirmation — an approval is a question for the person, not a step
 *    the agent took, so it is a card outside the trace with Cancel / Approve
 *    (eve's `style` hint wins: primary = filled, danger = red); once
 *    answered it becomes one line.
 *  - Suggestion — a question's options are a row of chips; "the label is
 *    the message, send it as is". Chips WRAP (no horizontal ScrollView
 *    inside the message list — AGENTS.md).
 * The caller decides what a tap does: the channel posts the person's own
 * message, the Assistant answers through `inputResponses`.
 */
export type ParkChoose = (request: ParkRequest, option: ParkOption) => Promise<void> | void;
export type ParkAnswer = (request: ParkRequest, text: string) => Promise<void> | void;

const INK = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";

export function SettledPark({ request }: { request: ParkRequest }) {
  const outcome = parkOutcome(request);
  return (
    <View style={styles.settled}>
      <Ionicons
        name={
          outcome === "denied"
            ? "close-circle-outline"
            : outcome === "withdrawn"
              ? "help-circle-outline"
              : "checkmark-circle-outline"
        }
        size={14}
        color={FAINT}
      />
      <Text style={styles.settledText} numberOfLines={2}>
        {settledParkLabel(request)}
      </Text>
    </View>
  );
}

function OptionButton({
  option,
  sent,
  filled,
  danger,
  disabled,
  onPress,
}: {
  option: ParkOption;
  sent: boolean;
  filled: boolean;
  danger: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={option.description ?? undefined}
      style={[
        styles.button,
        filled && styles.buttonFilled,
        danger && styles.buttonDanger,
        sent && styles.buttonSent,
        disabled && !sent && styles.disabled,
      ]}
    >
      {sent ? <Ionicons name="checkmark" size={13} color={filled || danger ? "#fff" : INK} /> : null}
      <Text style={[styles.buttonText, (filled || danger) && styles.buttonTextFilled]}>
        {option.label}
      </Text>
    </Pressable>
  );
}

function RequestControl({
  request,
  onChoose,
  onAnswer,
  disabled,
}: {
  request: ParkRequest;
  onChoose: ParkChoose | null;
  onAnswer: ParkAnswer | null;
  disabled: boolean;
}) {
  const [sentId, setSentId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const busy = disabled || sending || !onChoose;

  const choose = async (option: ParkOption) => {
    if (!onChoose || busy) return;
    setSending(true);
    try {
      await onChoose(request, option);
      setSentId(option.id);
    } catch {
      Alert.alert("Couldn't send", "That reply didn't go through — try again.");
    } finally {
      setSending(false);
    }
  };

  const answer = async () => {
    const value = text.trim();
    if (!onAnswer || !value || busy) return;
    setSending(true);
    try {
      await onAnswer(request, value);
      setSentId("__text");
      setText("");
    } catch {
      Alert.alert("Couldn't send", "That reply didn't go through — try again.");
    } finally {
      setSending(false);
    }
  };

  if (request.outcome) return <SettledPark request={request} />;

  const options = parkOptions(request);

  if (request.kind === "tool-approval" || request.kind === "session-limit") {
    const isLimit = request.kind === "session-limit";
    const lines = parkInputLines(request.action?.input);
    return (
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons
            name={isLimit ? "speedometer-outline" : "shield-checkmark-outline"}
            size={16}
            color={MUTED}
          />
          <Text style={styles.cardTitle}>{parkTitle(request)}</Text>
        </View>
        {isLimit && request.prompt ? <Text style={styles.cardBody}>{request.prompt}</Text> : null}
        {lines.length > 0 ? <Text style={styles.cardMono}>{lines.join("\n")}</Text> : null}
        <View style={styles.actions}>
          {options.map((option) => (
            <OptionButton
              key={option.id}
              option={option}
              sent={sentId === option.id}
              filled={option.style === "primary" || (!option.style && isAffirmativeOption(option))}
              danger={option.style === "danger"}
              disabled={busy}
              onPress={() => void choose(option)}
            />
          ))}
        </View>
      </View>
    );
  }

  // Question: the prompt is in the message text above; the chips carry the
  // choices, and a free-text answer is allowed when the tool said so.
  const freeform = onAnswer && (request.allowFreeform || options.length === 0);
  return (
    <View style={styles.question}>
      {options.length > 0 ? (
        <View style={styles.chips}>
          {options.map((option) => (
            <OptionButton
              key={option.id}
              option={option}
              sent={sentId === option.id}
              filled={option.style === "primary"}
              danger={option.style === "danger"}
              disabled={busy}
              onPress={() => void choose(option)}
            />
          ))}
        </View>
      ) : null}
      {freeform ? (
        <View style={styles.answerRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type an answer…"
            placeholderTextColor={FAINT}
            style={styles.answerInput}
            editable={!busy}
            onSubmitEditing={() => void answer()}
            returnKeyType="send"
          />
          <Pressable
            disabled={!text.trim() || busy}
            onPress={() => void answer()}
            style={[styles.button, styles.buttonFilled, (!text.trim() || busy) && styles.disabled]}
          >
            <Text style={[styles.buttonText, styles.buttonTextFilled]}>Answer</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function ParkControls({
  requests,
  onChoose,
  onAnswer = null,
  disabled = false,
}: {
  requests: ParkRequest[];
  /** A tap on an option. Null = read-only. */
  onChoose: ParkChoose | null;
  /** A typed answer to a question. Omit when the surface cannot accept one. */
  onAnswer?: ParkAnswer | null;
  disabled?: boolean;
}) {
  if (requests.length === 0) return null;
  return (
    <View style={styles.list}>
      {requests.map((request) => (
        <RequestControl
          key={request.requestId}
          request={request}
          onChoose={onChoose}
          onAnswer={onAnswer}
          disabled={disabled}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, alignSelf: "stretch" },
  settled: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  settledText: { fontSize: 13, color: MUTED, flex: 1 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    gap: 10,
    backgroundColor: "#ffffff",
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: INK, flex: 1 },
  cardBody: { fontSize: 13, color: MUTED, lineHeight: 18 },
  cardMono: { fontFamily: "Menlo", fontSize: 11, lineHeight: 16, color: MUTED },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 },
  question: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
  },
  buttonFilled: { backgroundColor: INK, borderColor: INK },
  buttonDanger: { backgroundColor: "#b91c1c", borderColor: "#b91c1c" },
  buttonSent: { opacity: 0.85 },
  buttonText: { fontSize: 13, color: INK, fontWeight: "500" },
  buttonTextFilled: { color: "#ffffff", fontWeight: "600" },
  disabled: { opacity: 0.4 },
  answerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  answerInput: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 12,
    fontSize: 14,
    color: INK,
  },
});
