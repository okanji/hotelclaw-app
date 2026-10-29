import { Ionicons } from "@expo/vector-icons";
import React, { useContext, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Circle, Path, Polygon, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { ChannelContext, MessageContext } from "stream-chat-expo";
import {
  chartSeries,
  formatFormSubmission,
  type ChatUiChartProps,
  type ChatUiFormField,
  type ChatUiQuestion,
} from "@hotelclaw/chat-ui";
import { useChatUiSubmitted, useOptionalChatUiSend } from "./chat-ui-send";

/**
 * The generative-UI half of the chat catalog on the phone — twins of
 * `apps/web/components/chat/ai-ui-generative.tsx` over the same props:
 *  - Chart — bar / line / area / pie drawn with react-native-svg (the
 *    series palette mirrors the web's `--series-*` ramp).
 *  - Form — an inline chat form; submitting sends the answers as the
 *    person's next message in the shared `formatFormSubmission` shape.
 *  - Questionnaire — one question per step with fixed choices, optional
 *    free text and progress (the shadcn Questionnaire pattern, natively).
 * No nested ScrollViews (the inverted-list rule): everything wraps.
 */

const SERIES = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
const INK = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";
const BORDER = "#e5e7eb";

/** The sender for a rendered element: the surface's override (Assistant)
 *  or the channel the message lives in (beside the bot message, or into
 *  its thread when it has one).
 *
 *  Reads Stream's contexts with plain `useContext`, NOT `useChannelContext()`
 *  — that hook THROWS outside a <Channel>, and the Assistant transcript
 *  renders these same elements with no channel around them. */
export function useReplySender(): ((text: string) => Promise<void>) | null {
  const override = useOptionalChatUiSend();
  const channelCtx = useContext(ChannelContext) as {
    channel?: { sendMessage: (m: Record<string, unknown>) => Promise<unknown> };
  } | null;
  const messageCtx = useContext(MessageContext) as { message?: { parent_id?: string } } | null;
  if (override) return async (text) => void (await override(text));
  const channel = channelCtx?.channel;
  if (!channel) return null;
  const parentId = messageCtx?.message?.parent_id;
  return async (text) => {
    await channel.sendMessage({
      text,
      ...(parentId ? { parent_id: parentId, show_in_channel: false } : {}),
    });
  };
}

function useWidth(initial = 0) {
  const [width, setWidth] = useState(initial);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };
  return { width, onLayout };
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

export function ChartView({ props }: { props: ChatUiChartProps }) {
  const { width, onLayout } = useWidth();
  const { categories, series } = useMemo(() => chartSeries(props), [props]);
  const height = 190;
  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 26;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const n = categories.length;

  const body = (() => {
    if (width === 0) return null;
    if (props.kind === "pie") {
      const first = series[0];
      const total = first ? first.values.reduce((a, b) => a + b, 0) : 0;
      const cx = width / 2;
      const cy = height / 2;
      const r = Math.min(width, height) / 2 - 8;
      let angle = -Math.PI / 2;
      return (
        <Svg width={width} height={height}>
          {first && total > 0
            ? first.values.map((v, i) => {
                const slice = (v / total) * Math.PI * 2;
                const start = angle;
                const end = angle + slice;
                angle = end;
                const large = slice > Math.PI ? 1 : 0;
                const x1 = cx + r * Math.cos(start);
                const y1 = cy + r * Math.sin(start);
                const x2 = cx + r * Math.cos(end);
                const y2 = cy + r * Math.sin(end);
                const ir = r * 0.55;
                const ix1 = cx + ir * Math.cos(end);
                const iy1 = cy + ir * Math.sin(end);
                const ix2 = cx + ir * Math.cos(start);
                const iy2 = cy + ir * Math.sin(start);
                const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${large} 0 ${ix2} ${iy2} Z`;
                return <Path key={i} d={d} fill={SERIES[i % SERIES.length]} stroke="#fff" strokeWidth={1.5} />;
              })
            : null}
          {total === 0 ? <Circle cx={cx} cy={cy} r={r} fill="#f3f4f6" /> : null}
        </Svg>
      );
    }
    const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) => padT + plotH - (v / max) * plotH;
    const grid = [0, 0.5, 1].map((t) => (
      <React.Fragment key={t}>
        <Rect x={padL} y={padT + plotH * (1 - t)} width={plotW} height={1} fill={BORDER} />
        <SvgText x={padL - 6} y={padT + plotH * (1 - t) + 4} fontSize={10} fill={FAINT} textAnchor="end">
          {String(Math.round(max * t))}
        </SvgText>
      </React.Fragment>
    ));
    const labels = categories.map((c, i) => {
      const cx = props.kind === "bar" ? padL + ((i + 0.5) / n) * plotW : x(i);
      return (
        <SvgText key={i} x={cx} y={height - 8} fontSize={10} fill={MUTED} textAnchor="middle">
          {c.length > 8 ? `${c.slice(0, 7)}…` : c}
        </SvgText>
      );
    });
    if (props.kind === "bar") {
      const groupW = plotW / Math.max(1, n);
      const barW = Math.max(4, (groupW * 0.7) / Math.max(1, series.length));
      return (
        <Svg width={width} height={height}>
          {grid}
          {series.map((s, si) =>
            s.values.map((v, i) => {
              const gx = padL + i * groupW + (groupW - barW * series.length) / 2;
              return (
                <Rect
                  key={`${si}-${i}`}
                  x={gx + si * barW}
                  y={y(v)}
                  width={barW - 1}
                  height={Math.max(0, padT + plotH - y(v))}
                  rx={2}
                  fill={SERIES[si % SERIES.length]}
                />
              );
            }),
          )}
          {labels}
        </Svg>
      );
    }
    return (
      <Svg width={width} height={height}>
        {grid}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          const color = SERIES[si % SERIES.length];
          return (
            <React.Fragment key={si}>
              {props.kind === "area" ? (
                <Polygon
                  points={`${x(0)},${padT + plotH} ${pts} ${x(n - 1)},${padT + plotH}`}
                  fill={color}
                  fillOpacity={0.18}
                />
              ) : null}
              <Polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
            </React.Fragment>
          );
        })}
        {labels}
      </Svg>
    );
  })();

  return (
    <View style={styles.block}>
      {props.title ? (
        <View style={styles.titleRow}>
          <Text style={styles.title}>{props.title}</Text>
        </View>
      ) : null}
      <View onLayout={onLayout} style={styles.chartBody}>
        {body}
      </View>
      {series.length > 1 || props.kind === "pie" ? (
        <View style={styles.legend}>
          {(props.kind === "pie" ? categories : series.map((s) => s.name)).map((name, i) => (
            <View key={`${name}-${i}`} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: SERIES[i % SERIES.length] }]} />
              <Text style={styles.legendText} numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {props.caption ? <Text style={styles.caption}>{props.caption}</Text> : null}
    </View>
  );
}

function SentLine({ label }: { label: string }) {
  return (
    <View style={[styles.block, styles.sentRow]}>
      <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
      <Text style={styles.sentText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Chip({
  label,
  on,
  disabled,
  onPress,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn, disabled && styles.disabled]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function FormView({
  props,
}: {
  props: { title?: string; description?: string; submitLabel?: string; fields: ChatUiFormField[] };
}) {
  const send = useReplySender();
  const alreadySent = useChatUiSubmitted(props.title);
  const [values, setValues] = useState<Record<string, string | string[] | boolean>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (id: string, value: string | string[] | boolean) =>
    setValues((v) => ({ ...v, [id]: value }));

  const missing = props.fields.filter((f) => {
    if (!f.required) return false;
    const v = values[f.id];
    return v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || v === false;
  });

  const submit = async () => {
    if (!send || sending) return;
    if (missing.length > 0) {
      Alert.alert("Missing answers", `Please fill in: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setSending(true);
    try {
      await send(
        formatFormSubmission(
          props.title,
          props.fields.map((f) => {
            const raw = values[f.id];
            const labelOf = (v: string) =>
              f.options?.find((o) => (o.value ?? o.label) === v)?.label ?? v;
            const value = Array.isArray(raw)
              ? raw.map(labelOf)
              : typeof raw === "string" && f.type === "select"
                ? labelOf(raw)
                : raw;
            return { label: f.label, value };
          }),
        ),
      );
      setSent(true);
    } catch {
      Alert.alert("Couldn't send", "Those answers didn't go through — try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent || alreadySent) return <SentLine label={`${props.title ? `${props.title} — ` : ""}answers sent`} />;
  const disabled = !send || sending;

  return (
    <View style={[styles.block, styles.form]}>
      {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
      {props.description ? <Text style={styles.description}>{props.description}</Text> : null}
      {props.fields.map((f) => {
        const options = f.options ?? [];
        const value = values[f.id];
        if (f.type === "checkbox") {
          return (
            <View key={f.id} style={styles.switchRow}>
              <Text style={styles.label}>{f.label}</Text>
              <Switch
                value={value === true}
                onValueChange={(v) => set(f.id, v)}
                disabled={disabled}
              />
            </View>
          );
        }
        return (
          <View key={f.id} style={styles.field}>
            <Text style={styles.label}>
              {f.label}
              {f.required ? <Text style={styles.required}> *</Text> : null}
            </Text>
            {f.type === "select" || f.type === "multiselect" ? (
              <View style={styles.chips}>
                {options.map((o) => {
                  const v = o.value ?? o.label;
                  const chosen = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
                  const on = chosen.includes(v);
                  return (
                    <Chip
                      key={v}
                      label={o.label}
                      on={on}
                      disabled={disabled}
                      onPress={() =>
                        f.type === "select"
                          ? set(f.id, on ? "" : v)
                          : set(f.id, on ? chosen.filter((c) => c !== v) : [...chosen, v])
                      }
                    />
                  );
                })}
              </View>
            ) : (
              <TextInput
                value={typeof value === "string" ? value : ""}
                onChangeText={(t) => set(f.id, t)}
                placeholder={
                  f.placeholder ??
                  (f.type === "date" ? "YYYY-MM-DD" : f.type === "time" ? "HH:MM" : undefined)
                }
                placeholderTextColor={FAINT}
                keyboardType={f.type === "number" ? "numeric" : "default"}
                multiline={f.type === "textarea"}
                editable={!disabled}
                style={[styles.input, f.type === "textarea" && styles.textarea]}
              />
            )}
          </View>
        );
      })}
      <View style={styles.actions}>
        <Pressable
          disabled={disabled}
          onPress={() => void submit()}
          style={[styles.primary, disabled && styles.disabled]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{props.submitLabel ?? "Send"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function QuestionnaireView({
  props,
}: {
  props: { title?: string; questions: ChatUiQuestion[] };
}) {
  const send = useReplySender();
  const alreadySent = useChatUiSubmitted(props.title);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const total = props.questions.length;
  const q = props.questions[Math.min(step, total - 1)];
  const chosen = answers[q.id] ?? [];
  const answered = chosen.length > 0 || Boolean(other[q.id]?.trim());
  const last = step === total - 1;
  const disabled = !send || sending;

  const toggle = (value: string) => {
    setAnswers((a) => {
      const current = a[q.id] ?? [];
      if (q.multiple) {
        return { ...a, [q.id]: current.includes(value) ? current.filter((c) => c !== value) : [...current, value] };
      }
      return { ...a, [q.id]: current.includes(value) ? [] : [value] };
    });
  };

  const submit = async () => {
    if (!send || sending) return;
    const missing = props.questions.filter(
      (question) =>
        question.required &&
        (answers[question.id] ?? []).length === 0 &&
        !other[question.id]?.trim(),
    );
    if (missing.length > 0) {
      setStep(props.questions.indexOf(missing[0]));
      Alert.alert("One more answer", `"${missing[0].prompt}" needs an answer.`);
      return;
    }
    setSending(true);
    try {
      await send(
        formatFormSubmission(
          props.title,
          props.questions.map((question) => {
            const labels = (answers[question.id] ?? []).map(
              (v) => question.choices.find((c) => (c.value ?? c.label) === v)?.label ?? v,
            );
            const extra = other[question.id]?.trim();
            return { label: question.prompt, value: extra ? [...labels, extra] : labels };
          }),
        ),
      );
      setSent(true);
    } catch {
      Alert.alert("Couldn't send", "Those answers didn't go through — try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent || alreadySent) return <SentLine label={`${props.title ? `${props.title} — ` : ""}answers sent`} />;

  return (
    <View style={[styles.block, styles.form]}>
      {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
      <Text style={styles.progress}>
        {step + 1} of {total}
      </Text>
      <Text style={styles.prompt}>{q.prompt}</Text>
      {q.description ? <Text style={styles.description}>{q.description}</Text> : null}
      <View style={styles.choices}>
        {q.choices.map((c) => {
          const v = c.value ?? c.label;
          const on = chosen.includes(v);
          return (
            <Pressable
              key={v}
              disabled={disabled}
              onPress={() => toggle(v)}
              accessibilityRole={q.multiple ? "checkbox" : "radio"}
              accessibilityState={{ checked: on }}
              style={[styles.choice, on && styles.choiceOn]}
            >
              <View style={[styles.indicator, q.multiple && styles.indicatorSquare, on && styles.indicatorOn]}>
                {on ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
              </View>
              <View style={styles.choiceText}>
                <Text style={styles.choiceLabel}>{c.label}</Text>
                {c.description ? <Text style={styles.choiceDesc}>{c.description}</Text> : null}
              </View>
            </Pressable>
          );
        })}
        {q.allowOther ? (
          <TextInput
            value={other[q.id] ?? ""}
            onChangeText={(t) => setOther((o) => ({ ...o, [q.id]: t }))}
            placeholder="Something else…"
            placeholderTextColor={FAINT}
            editable={!disabled}
            style={styles.input}
          />
        ) : null}
      </View>
      <View style={styles.actions}>
        {step > 0 ? (
          <Pressable onPress={() => setStep((s) => s - 1)} style={styles.secondary} disabled={disabled}>
            <Text style={styles.secondaryText}>Previous</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {!q.required && !answered && !last ? (
          <Pressable onPress={() => setStep((s) => s + 1)} style={styles.secondary} disabled={disabled}>
            <Text style={styles.secondaryText}>Skip</Text>
          </Pressable>
        ) : null}
        {last ? (
          <Pressable
            onPress={() => void submit()}
            style={[styles.primary, disabled && styles.disabled]}
            disabled={disabled}
          >
            <Text style={styles.primaryText}>Submit</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setStep((s) => s + 1)}
            style={[styles.primary, (disabled || (q.required && !answered)) && styles.disabled]}
            disabled={disabled || (q.required && !answered)}
          >
            <Text style={styles.primaryText}>Next</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    overflow: "hidden",
  },
  titleRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f9fafb",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  title: { fontSize: 14, fontWeight: "600", color: INK },
  chartBody: { paddingHorizontal: 8, paddingTop: 8, minHeight: 190 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 12, paddingBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: MUTED, maxWidth: 140 },
  caption: { fontSize: 12, color: MUTED, paddingHorizontal: 12, paddingBottom: 10 },
  sentRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  sentText: { fontSize: 13, color: MUTED, flex: 1 },
  form: { padding: 12, gap: 10 },
  description: { fontSize: 13, color: MUTED, lineHeight: 18 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "500", color: INK },
  required: { color: MUTED },
  input: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: INK,
    backgroundColor: "#fff",
  },
  textarea: { minHeight: 72, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
  },
  chipOn: { backgroundColor: "#f3f4f6", borderColor: INK },
  chipText: { fontSize: 13, color: INK },
  chipTextOn: { fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 },
  primary: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: INK },
  primaryText: { fontSize: 13, color: "#fff", fontWeight: "600" },
  secondary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
  },
  secondaryText: { fontSize: 13, color: INK, fontWeight: "500" },
  disabled: { opacity: 0.4 },
  progress: { fontSize: 12, color: FAINT, fontVariant: ["tabular-nums"] },
  prompt: { fontSize: 15, fontWeight: "600", color: INK, lineHeight: 21 },
  choices: { gap: 8 },
  choice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  choiceOn: { backgroundColor: "#f3f4f6", borderColor: INK },
  indicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  indicatorSquare: { borderRadius: 4 },
  indicatorOn: { backgroundColor: INK, borderColor: INK },
  choiceText: { flex: 1, gap: 2 },
  choiceLabel: { fontSize: 14, color: INK, fontWeight: "500" },
  choiceDesc: { fontSize: 12, color: MUTED, lineHeight: 17 },
});
