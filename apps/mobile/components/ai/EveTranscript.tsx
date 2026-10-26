import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  displayUserText,
  renderedSpecs,
  type AssistantItem,
  type TranscriptItem,
} from "@hotelclaw/chat-ui/transcript";
import { runningLabel, transcriptTurnSteps } from "@hotelclaw/chat-ui/turn";
import { AiUiAttachment } from "../attachments/AiUiAttachment";
import { AiLoader } from "../AiLoader";
import { Markdown } from "./Markdown";
import { ParkControls } from "./ParkControls";
import { ReplyActions } from "./ReplyActions";
import { TurnTrace } from "./TurnTrace";

/**
 * Mobile renderer for an eve transcript — the phone twin of web's
 * `components/ai/eve-conversation.tsx` over the SAME reducer items, drawn
 * in the same order the shadcn/ui "Chat" pattern prescribes: the person's
 * turn as a bubble; the agent's turn as its trace (`TurnTrace` over
 * `transcriptTurnSteps`: reasoning, tools, subagents, settled parks), the
 * reply as markdown, `render_ui` cards through the existing
 * `AiUiAttachment`, the controls for an OPEN park (`ParkControls`), a
 * failure note, and the footer actions (copy, 👍/👎 for the learning loop).
 *
 * Rendered INSIDE the caller's scroll view (a FlatList inverted trick isn't
 * worth it for a transcript that is rebuilt whole on every event).
 */
type Respond = (requestId: string, answer: { optionId?: string; text?: string }) => void;

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
  onRespond?: Respond;
  workingLabel?: string;
}) {
  const last = items[items.length - 1];
  // The live turn's trace already says what is happening; the loader only
  // covers the gap before its first event (and a resume).
  const showLoader =
    resuming ||
    (busy &&
      !(
        last &&
        last.kind === "assistant" &&
        (last.text.trim() || last.toolCalls.length > 0 || last.reasoning.length > 0)
      ));
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
      {showLoader ? (
        <View style={styles.loader}>
          <AiLoader
            label={resuming ? "Loading this conversation…" : workingLabel}
            showElapsed={!resuming}
          />
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
  onRespond?: Respond;
}) {
  const specs = useMemo(() => renderedSpecs(item.toolCalls), [item.toolCalls]);
  const steps = useMemo(() => transcriptTurnSteps(item, { running: live }), [item, live]);
  const hasText = Boolean(item.text.trim());
  const runningStep = live ? steps.find((s) => s.status === "running") : undefined;
  const activity = runningStep
    ? runningStep.kind === "reasoning"
      ? "Thinking…"
      : `${runningLabel(runningStep.label)}…`
    : hasText
      ? "Writing…"
      : "Working on it…";
  const openRequests = item.requests.filter((r) => !r.outcome);
  return (
    <View style={styles.assistant}>
      {steps.length > 0 || live ? (
        <TurnTrace steps={steps} live={live && !hasText} activity={activity} />
      ) : null}
      {hasText ? <Markdown>{item.text}</Markdown> : null}
      {specs.map((entry) => (
        <AiUiAttachment
          key={entry.callId}
          attachment={{ type: "ai_ui", spec: entry.spec } as never}
        />
      ))}
      {openRequests.length > 0 ? (
        <ParkControls
          requests={openRequests}
          onChoose={
            onRespond
              ? (request, option) => onRespond(request.requestId, { optionId: option.id })
              : null
          }
          onAnswer={onRespond ? (request, text) => onRespond(request.requestId, { text }) : null}
        />
      ) : null}
      {item.failure ? (
        <Text style={styles.failure}>{item.failure.message || "That turn failed."}</Text>
      ) : null}
      {hasText && !live ? (
        <ReplyActions
          text={item.text}
          messageKey={messageKey}
          feedback={{ propertyId, surface, sessionId }}
        />
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
  failure: { fontSize: 13, color: "#b91c1c" },
});
