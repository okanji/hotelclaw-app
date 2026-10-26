import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EveTranscript } from "../../components/ai/EveTranscript";
import { EmptyState, Loading } from "../../components/ui";
import { usePropertyContext } from "../../contexts/PropertyContext";
import { useEveSession } from "../../hooks/useEveSession";
import { supabase } from "../../lib/supabase";

/**
 * One assistant conversation — a durable eve session addressed as the
 * virtual `assistant` bot (`x-hotelclaw-bot: assistant`, Bearer auth). The
 * session id lives on the `assistant_chats` row, so resuming here replays
 * the same event log the web pane would. Questions and approvals the
 * assistant parks on are answered inline; `?prefill=` carries a starter
 * prompt from the list screen.
 */
type ChatRow = {
  id: string;
  title: string;
  eve_session_id: string | null;
  project_id: string | null;
};

export default function AssistantChatScreen() {
  const { chatId, prefill } = useLocalSearchParams<{ chatId: string; prefill?: string }>();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id ?? null;
  const [row, setRow] = useState<ChatRow | null | undefined>(undefined);

  useEffect(() => {
    if (!chatId) return;
    void supabase
      .from("assistant_chats")
      .select("id, title, eve_session_id, project_id")
      .eq("id", chatId)
      .maybeSingle()
      .then(({ data }) => setRow((data as ChatRow | null) ?? null));
  }, [chatId]);

  if (!propertyId || !chatId) return <EmptyState title="Conversation unavailable" />;
  if (row === undefined) return <Loading label="Opening conversation…" />;
  if (row === null) return <EmptyState title="This conversation isn't yours or no longer exists" />;
  return <Chat propertyId={propertyId} row={row} prefill={prefill ?? null} />;
}

function Chat({ propertyId, row, prefill }: { propertyId: string; row: ChatRow; prefill: string | null }) {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState("");
  const [title, setTitle] = useState(row.title);
  const [error, setError] = useState<string | null>(null);

  const onTurn = useCallback(
    async ({ sessionId, isFirstTurn, message }: { sessionId: string; isFirstTurn: boolean; message: string }) => {
      const patch: Record<string, unknown> = {
        eve_session_id: sessionId,
        continuation_token: null,
        last_message_at: new Date().toISOString(),
      };
      if (isFirstTurn && (row.title === "New chat" || !row.eve_session_id)) {
        patch.title = message.slice(0, 140);
        setTitle(message.slice(0, 140));
      }
      await supabase.from("assistant_chats").update(patch).eq("id", row.id);
    },
    [row.eve_session_id, row.id, row.title],
  );

  const session = useEveSession({
    propertyId,
    extraHeaders: {
      "x-hotelclaw-bot": "assistant",
      ...(row.project_id ? { "x-hotelclaw-project": row.project_id } : {}),
    },
    initialSessionId: row.eve_session_id,
    frameFirstMessage: (text) => `[Now: ${new Date().toISOString()} (UTC)]\n\n${text}`,
    onTurn,
    onError: setError,
  });

  const send = (text: string) => {
    setError(null);
    setInput("");
    void session.send(text);
  };

  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !prefill?.trim() || session.resuming) return;
    prefilledRef.current = true;
    send(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, session.resuming]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [session.items, session.busy]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title }} />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardDismissMode="interactive">
        {session.items.length === 0 && !session.resuming && !session.busy ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>What can I help with?</Text>
            <Text style={styles.emptyBody}>
              Ask about tasks, documents, bookings, the calendar — or tell me to change something.
            </Text>
          </View>
        ) : null}
        <EveTranscript
          items={session.items}
          busy={session.busy}
          resuming={session.resuming}
          propertyId={propertyId}
          surface="assistant"
          sessionId={session.sessionId}
          onRespond={(requestId, answer) => void session.respond(requestId, answer)}
          onSend={(text) => void session.send(text)}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={
            session.pending.length > 0 ? "Answer above, or type a message…" : "Message the assistant…"
          }
          placeholderTextColor="#9ca3af"
          style={styles.input}
          multiline
          editable={!session.busy}
        />
        {session.busy ? (
          <Pressable style={styles.send} onPress={() => void session.cancel()} accessibilityLabel="Stop">
            <Ionicons name="stop" size={16} color="#ffffff" />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.send, !input.trim() && styles.disabled]}
            disabled={!input.trim()}
            onPress={() => send(input)}
            accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={16} color="#ffffff" />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 12 },
  empty: { paddingHorizontal: 20, paddingTop: 40, gap: 8, alignItems: "center" },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#111827" },
  emptyBody: { fontSize: 14, lineHeight: 20, color: "#6b7280", textAlign: "center" },
  error: { marginHorizontal: 16, fontSize: 13, color: "#b91c1c" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: 14,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.35 },
});
