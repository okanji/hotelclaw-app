import { useEffect, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import type { Channel as ChannelType } from "stream-chat";
import { apiFetch } from "../lib/api";

/** Keep in sync with apps/web/lib/ai/bot-identity.ts (client-safe defaults). */
const BOT_USER_ID = "hotelclaw-ai";
const BOT_DISPLAY_NAME = "Hotelclaw";

type AiMode = "mention" | "engaged" | "auto" | "always";
type AiSensitivity = "conservative" | "balanced" | "eager";

/** Same copy as the web header menu (components/chat/channel-header/ai-button.tsx). */
const MODE_OPTIONS: { value: AiMode; label: string; hint: string }[] = [
  {
    value: "mention",
    label: "Mention",
    hint: `Replies only when you @${BOT_USER_ID}.`,
  },
  {
    value: "engaged",
    label: "Engaged",
    hint: "Mention to start, then it stays in the thread until the topic wraps.",
  },
  {
    value: "auto",
    label: "Auto",
    hint: "Listens to the channel and chimes in when it can help.",
  },
  {
    value: "always",
    label: "Always",
    hint: "Replies to every top-level message. Best for 1:1 AI channels.",
  },
];

const SENSITIVITY_OPTIONS: {
  value: AiSensitivity;
  label: string;
  hint: string;
}[] = [
  {
    value: "conservative",
    label: "Conservative",
    hint: "Only unaddressed questions, corrections, or offers to help.",
  },
  {
    value: "balanced",
    label: "Balanced",
    hint: "Also adds relevant context and brief clarifying questions.",
  },
  {
    value: "eager",
    label: "Eager",
    hint: "Also summaries and related ideas. Most participatory.",
  },
];

function isBotMember(channel: ChannelType): boolean {
  return Object.values(channel.state.members ?? {}).some(
    (m) => m?.user?.id === BOT_USER_ID,
  );
}

function readMode(data: Record<string, unknown> | undefined): AiMode {
  const raw = (data as { ai_mode?: string } | undefined)?.ai_mode;
  if (raw === "always" || raw === "auto" || raw === "engaged") return raw;
  return "mention";
}

function readSensitivity(
  data: Record<string, unknown> | undefined,
): AiSensitivity {
  const raw = (data as { ai_sensitivity?: string } | undefined)?.ai_sensitivity;
  if (raw === "conservative" || raw === "eager") return raw;
  return "balanced";
}

/**
 * Channel-wide AI reply settings — the mobile counterpart of the web app's
 * channel-header AI button. Same four modes + auto sensitivity, persisted
 * through the same web API routes (Bearer-authed via lib/api.ts), stored as
 * Stream channel custom fields the message-new webhook reads. Settings here
 * apply to the whole channel, on every client.
 *
 * The body only mounts while the sheet is open, so each open re-reads the
 * channel's current state in the initializers (another client may have
 * changed the mode since last time) — no reset-on-open effect needed.
 */
export function AiModeSheet({
  channel,
  visible,
  onClose,
}: {
  channel: ChannelType;
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {visible ? <AiModeBody channel={channel} onClose={onClose} /> : null}
    </Modal>
  );
}

function AiModeBody({
  channel,
  onClose,
}: {
  channel: ChannelType;
  onClose: () => void;
}) {
  const [botMember, setBotMember] = useState(() => isBotMember(channel));
  const [mode, setMode] = useState<AiMode>(() => readMode(channel.data));
  const [sensitivity, setSensitivity] = useState<AiSensitivity>(() =>
    readSensitivity(channel.data),
  );
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  // Follow live channel events while open — mirrors the web button's
  // listeners, so a change made on another client shows up immediately.
  useEffect(() => {
    const onMembers = () => setBotMember(isBotMember(channel));
    const sub1 = channel.on("member.added", onMembers);
    const sub2 = channel.on("member.removed", onMembers);
    const sub3 = channel.on("channel.updated", () => {
      setMode(readMode(channel.data));
      setSensitivity(readSensitivity(channel.data));
    });
    return () => {
      sub1.unsubscribe();
      sub2.unsubscribe();
      sub3.unsubscribe();
    };
  }, [channel]);

  async function activate() {
    if (!channel.id || busy) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ warning?: string }>("/api/stream/ai/start", {
        method: "POST",
        body: { channelId: channel.id, channelType: channel.type },
      });
      setBotMember(true);
      if (result.warning) Alert.alert("Heads up", result.warning);
    } catch (e) {
      Alert.alert(
        "Couldn't activate the assistant",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function persist(next: { mode: AiMode; sensitivity: AiSensitivity }) {
    if (!channel.id || saving) return;
    const prev = { mode, sensitivity };
    setMode(next.mode);
    setSensitivity(next.sensitivity);
    setSaving(true);
    try {
      await apiFetch("/api/stream/ai/mode", {
        method: "POST",
        body: {
          channelId: channel.id,
          channelType: channel.type,
          mode: next.mode,
          // Only send sensitivity in auto mode — matches the web button.
          ...(next.mode === "auto" ? { sensitivity: next.sensitivity } : {}),
        },
      });
    } catch (e) {
      setMode(prev.mode);
      setSensitivity(prev.sensitivity);
      Alert.alert(
        "Couldn't change reply settings",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.bar}>
          <View style={styles.barTitle}>
            <Ionicons name="sparkles" size={16} color="#111827" />
            <Text style={styles.title}>AI assistant</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {botMember ? (
            <>
              <Text style={styles.sectionTitle}>Reply mode</Text>
              <Text style={styles.sectionHint}>
                Applies to this channel for everyone.
              </Text>
              <View style={styles.group}>
                {MODE_OPTIONS.map((opt, i) => (
                  <OptionRow
                    key={opt.value}
                    label={opt.label}
                    hint={opt.hint}
                    selected={mode === opt.value}
                    first={i === 0}
                    disabled={saving}
                    onPress={() => void persist({ mode: opt.value, sensitivity })}
                  />
                ))}
              </View>

              {mode === "auto" ? (
                <>
                  <Text style={styles.sectionTitle}>Chime sensitivity</Text>
                  <View style={styles.group}>
                    {SENSITIVITY_OPTIONS.map((opt, i) => (
                      <OptionRow
                        key={opt.value}
                        label={opt.label}
                        hint={opt.hint}
                        selected={sensitivity === opt.value}
                        first={i === 0}
                        disabled={saving}
                        onPress={() =>
                          void persist({ mode, sensitivity: opt.value })
                        }
                      />
                    ))}
                  </View>
                </>
              ) : null}
            </>
          ) : (
            <View style={styles.activateCard}>
              <Ionicons name="sparkles" size={22} color="#111827" />
              <Text style={styles.activateTitle}>{BOT_DISPLAY_NAME} AI</Text>
              <Text style={styles.activateBody}>
                An in-channel teammate powered by Claude. It can look up tasks,
                documents, and meetings in this property.
              </Text>
              <Pressable
                style={[styles.activateButton, busy && styles.buttonDisabled]}
                onPress={() => void activate()}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.activateButtonText}>
                    Activate in this channel
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
    </View>
  );
}

function OptionRow({
  label,
  hint,
  selected,
  first,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  first: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.row, !first && styles.rowBorder, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark" size={20} color="#2563eb" />
      ) : null}
    </Pressable>
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
  barTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 16, fontWeight: "600" },
  done: { fontSize: 16, fontWeight: "600", color: "#2563eb" },
  content: { padding: 16, paddingBottom: 48 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
  },
  sectionHint: { fontSize: 13, color: "#9ca3af", marginTop: 2 },
  group: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
  },
  rowDisabled: { opacity: 0.5 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: "600", color: "#111827" },
  rowHint: { fontSize: 13, color: "#6b7280", lineHeight: 18 },
  activateCard: {
    marginTop: 24,
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  activateTitle: { fontSize: 17, fontWeight: "600", color: "#111827" },
  activateBody: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
  activateButton: {
    marginTop: 12,
    backgroundColor: "#111827",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 200,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  activateButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
});
