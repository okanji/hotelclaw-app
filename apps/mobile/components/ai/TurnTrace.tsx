import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";
import {
  extractSources,
  isWebTool,
  pretty,
  settledLabel,
  stepDuration,
  stepGlyph,
  stepTitle,
  traceSummary,
  visibleSteps,
  HIDDEN_LABELS,
  type StepGlyph,
  type SummaryStep,
  type TurnStep,
} from "@hotelclaw/chat-ui/turn";
import { AiElapsed, AiShimmerLabel, fadeUpEntering } from "../AiLoader";
import { useTurnSteps } from "../../lib/turn-activity";

/**
 * The steps behind an AI turn — the phone twin of the web's `TurnTrace`
 * (`apps/web/components/ai/agent-turn/turn-trace.tsx`), drawn with plain RN
 * views over the SAME `TurnStep[]` from `@hotelclaw/chat-ui/turn`, so a
 * channel reply, the Assistant, and the task sheet show the same rows with
 * the same titles. The anatomy follows the shadcn/ui AI Elements patterns
 * the web composes:
 *  - Chain of Thought — the summary line ("Worked through 5 steps · 15s")
 *    that opens into the steps; open while running, the reader's toggle
 *    wins once they touch it.
 *  - Tool — a line while a call runs; tap a settled one for the input and
 *    output in a mono block.
 *  - Reasoning — "Thinking" → "Thought", the text inside.
 *  - Subagent — "Ran the X subagent" with how it ended.
 *  - Sources — tappable page links when a web search returned pages.
 * Open parks render outside the trace (ParkControls); settled ones are lines.
 *
 * NO nested ScrollViews (the inverted-list rule in AGENTS.md): long payloads
 * clip to a line count with a "Show more" toggle instead.
 */

const GLYPH_ICON: Record<StepGlyph, keyof typeof Ionicons.glyphMap> = {
  skill: "book-outline",
  agent: "git-branch-outline",
  question: "help-circle-outline",
  approval: "shield-checkmark-outline",
  web: "globe-outline",
  memory: "bulb-outline",
  search: "search-outline",
  read: "document-text-outline",
  write: "create-outline",
  view: "grid-outline",
  reasoning: "bulb-outline",
  tool: "construct-outline",
};

const INK = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";
const WARN = "#b45309";

function Spinner() {
  return <ActivityIndicator size="small" color={MUTED} style={styles.spinner} />;
}

function StatusGlyph({ status }: { status?: "running" | "error" | "cancelled" }) {
  if (status === "running") return <Spinner />;
  if (status === "error") return <Ionicons name="alert-circle-outline" size={14} color={WARN} />;
  if (status === "cancelled")
    return <Ionicons name="close-circle-outline" size={14} color={FAINT} />;
  return <Ionicons name="checkmark-circle-outline" size={14} color={FAINT} />;
}

/** A mono payload block, clipped with a "Show more" toggle (no ScrollView). */
function MonoBlock({ text, tone = "default" }: { text: string; tone?: "default" | "error" }) {
  const [all, setAll] = useState(false);
  const lines = text.split("\n").length;
  const clipped = !all && lines > 18;
  return (
    <View style={[styles.mono, tone === "error" && styles.monoError]}>
      <Text
        style={[styles.monoText, tone === "error" && styles.monoTextError]}
        numberOfLines={clipped ? 18 : undefined}
      >
        {text}
      </Text>
      {lines > 18 ? (
        <Pressable hitSlop={6} onPress={() => setAll((v) => !v)}>
          <Text style={styles.showMore}>{all ? "Show less" : `Show all ${lines} lines`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function StepRow({ step, live, index }: { step: TurnStep; live: boolean; index: number }) {
  const [open, setOpen] = useState<boolean | undefined>();
  const running = step.status === "running" && live;
  const stranded = step.status === "running" && !live;
  const failed = step.status === "failed" || stranded;
  const cancelled = step.status === "cancelled";
  const isPark = step.kind === "question" || step.kind === "approval";
  const title = stepTitle(step, live);
  const duration = running || isPark ? null : stepDuration(step);
  const sources = useMemo(
    () => (isWebTool(step.toolName) ? extractSources(step.output) : []),
    [step.toolName, step.output],
  );

  const hasInput = step.input !== null && step.input !== undefined && step.input !== "";
  const hasOutput = step.output !== null && step.output !== undefined && step.output !== "";
  const outputText = hasOutput ? pretty(step.output) : "";
  const hasBody =
    !isPark &&
    (step.kind === "reasoning"
      ? Boolean(step.detail)
      : Boolean(step.detail) || hasInput || hasOutput || sources.length > 0);
  const expanded = open ?? (step.kind === "reasoning" ? running : failed && !running);

  const glyph = (
    <View style={styles.rowIcon}>
      {running ? (
        <Spinner />
      ) : step.kind === "reasoning" ? (
        <Ionicons name="checkmark-circle-outline" size={14} color={FAINT} />
      ) : step.kind === "task" || step.kind === "step" || step.kind === "thinking" ? (
        <StatusGlyph status={failed ? "error" : cancelled ? "cancelled" : undefined} />
      ) : (
        <Ionicons
          name={GLYPH_ICON[stepGlyph(step)]}
          size={14}
          color={failed ? WARN : FAINT}
        />
      )}
    </View>
  );

  return (
    <Animated.View entering={fadeUpEntering(Math.min(index, 6))}>
      <Pressable
        disabled={!hasBody}
        onPress={() => setOpen(!expanded)}
        hitSlop={4}
        accessibilityRole={hasBody ? "button" : undefined}
        accessibilityState={hasBody ? { expanded } : undefined}
        style={styles.row}
      >
        {glyph}
        <Text
          style={[styles.rowTitle, running && styles.rowTitleLive, failed && styles.rowTitleError]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {duration ? <Text style={styles.rowMeta}>{duration}</Text> : null}
        {hasBody ? (
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color={FAINT} />
        ) : null}
      </Pressable>
      {expanded && hasBody ? (
        <View style={styles.rowBody}>
          {step.kind === "reasoning" ? (
            <Text style={styles.reasoning}>{step.detail}</Text>
          ) : (
            <>
              {step.detail ? (
                failed ? (
                  <MonoBlock text={step.detail} tone="error" />
                ) : (
                  <Text style={styles.detail}>{step.detail}</Text>
                )
              ) : null}
              {sources.length > 0 ? (
                <View style={styles.sources}>
                  {sources.map((source) => (
                    <Pressable
                      key={source.url}
                      onPress={() => void Linking.openURL(source.url)}
                      style={styles.source}
                      accessibilityRole="link"
                    >
                      <Ionicons name="globe-outline" size={13} color={FAINT} />
                      <Text style={styles.sourceTitle} numberOfLines={1}>
                        {source.title}
                      </Text>
                      <Ionicons name="open-outline" size={12} color={FAINT} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {hasInput ? <MonoBlock text={pretty(step.input)} /> : null}
              {hasOutput && sources.length === 0 && outputText !== step.detail ? (
                <MonoBlock text={outputText} />
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </Animated.View>
  );
}

export function TurnTrace({
  summary,
  steps: givenSteps,
  live = false,
  activity = null,
  fetchKey = null,
  style,
}: {
  /** A channel message's `eve_steps` (labels + times). */
  summary?: SummaryStep[] | null;
  /** Structured rows when the caller has them (transcripts, the live row). */
  steps?: TurnStep[] | null;
  live?: boolean;
  /** The live status line (what the agent is doing right now). */
  activity?: string | null;
  /** Lets a settled channel trace load its rows when opened. */
  fetchKey?: { channelId: string; turnNonce: string } | null;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState<boolean | undefined>();
  const expanded = open ?? live;
  const fetched = useTurnSteps({
    channelId: fetchKey?.channelId ?? null,
    turnNonce: fetchKey?.turnNonce ?? null,
    enabled: expanded && !givenSteps && !!fetchKey,
  });
  const rows = givenSteps ?? fetched.steps;
  const shown = useMemo(() => (rows ? visibleSteps(rows) : null), [rows]);
  const figures = useMemo(() => traceSummary(rows, summary, live), [rows, summary, live]);

  if (!live && figures.counted === 0 && !figures.reasoningOnly) return null;

  // Reasoning with no tool work needs no summary wrapper — the Thought row
  // IS the trace.
  if (!live && figures.reasoningOnly && shown) {
    return (
      <View style={style}>
        {shown.map((step, i) => (
          <StepRow key={step.id} step={step} live={false} index={i} />
        ))}
      </View>
    );
  }

  const status = live ? "running" : figures.failed > 0 ? "error" : undefined;
  const title = live ? (activity ?? "Thinking…").replace(/…$/, "") : figures.title;

  return (
    <View style={[styles.wrap, style]}>
      <Pressable
        onPress={() => setOpen(!expanded)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.header}
      >
        <View style={styles.rowIcon}>
          <StatusGlyph status={status} />
        </View>
        {live ? (
          <AiShimmerLabel style={styles.headerLive}>{title}</AiShimmerLabel>
        ) : (
          <Text style={styles.headerText} numberOfLines={1}>
            {title}
          </Text>
        )}
        {live ? (
          <AiElapsed style={styles.headerMeta} />
        ) : figures.duration ? (
          <Text style={styles.headerMeta}>{figures.duration}</Text>
        ) : null}
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color={FAINT} />
      </Pressable>
      {expanded ? (
        <View style={styles.rail}>
          {shown ? (
            shown.length > 0 ? (
              shown.map((step, i) => <StepRow key={step.id} step={step} live={live} index={i} />)
            ) : (
              <Text style={styles.empty}>{live ? "Starting…" : "No steps recorded."}</Text>
            )
          ) : fetched.loading ? (
            <Text style={styles.empty}>Loading the steps…</Text>
          ) : (
            // Rows unavailable (older turn, or the fetch failed): the labels
            // the message carries still tell the story.
            (summary ?? [])
              .filter((s) => !HIDDEN_LABELS.has(s.label))
              .map((s, i) => (
                <Animated.View
                  key={`${s.at}-${i}`}
                  entering={fadeUpEntering(Math.min(i, 6))}
                  style={styles.row}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="checkmark-circle-outline" size={14} color={FAINT} />
                  </View>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {settledLabel(s.label)}
                  </Text>
                </Animated.View>
              ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
  },
  headerText: { fontSize: 13, color: MUTED, fontWeight: "500", flexShrink: 1 },
  headerLive: { fontSize: 13, fontWeight: "500", flexShrink: 1 },
  headerMeta: { fontSize: 12, color: FAINT, fontVariant: ["tabular-nums"] },
  rail: {
    marginTop: 2,
    marginLeft: 7,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: "#e5e7eb",
    gap: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
  },
  rowIcon: { width: 16, alignItems: "center", justifyContent: "center" },
  spinner: { transform: [{ scale: 0.7 }] },
  rowTitle: { fontSize: 13, color: MUTED, flex: 1 },
  rowTitleLive: { color: INK },
  rowTitleError: { color: WARN },
  rowMeta: { fontSize: 12, color: FAINT, fontVariant: ["tabular-nums"] },
  rowBody: { marginLeft: 22, marginTop: 2, marginBottom: 6, gap: 6 },
  reasoning: { fontSize: 13, lineHeight: 19, color: MUTED },
  detail: { fontSize: 13, lineHeight: 19, color: INK },
  mono: { backgroundColor: "#f3f4f6", borderRadius: 8, padding: 8, gap: 4 },
  monoError: { backgroundColor: "#fef2f2" },
  monoText: { fontFamily: "Menlo", fontSize: 11, lineHeight: 16, color: INK },
  monoTextError: { color: "#b91c1c" },
  showMore: { fontSize: 12, color: MUTED, fontWeight: "500" },
  sources: { gap: 4 },
  source: { flexDirection: "row", alignItems: "center", gap: 6 },
  sourceTitle: { fontSize: 13, color: INK, flex: 1, textDecorationLine: "underline" },
  empty: { fontSize: 13, color: FAINT, paddingVertical: 3 },
});
