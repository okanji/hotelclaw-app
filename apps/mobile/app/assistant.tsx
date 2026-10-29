import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { usePropertyContext } from "../contexts/PropertyContext";
import { supabase } from "../lib/supabase";

/**
 * Assistant home — your private conversations with the workspace AI, the
 * phone twin of the web's Assistant section. Rows come straight from
 * `assistant_chats` under RLS (personal rows: `user_id = auth.uid()` AND
 * member of the property — a missed filter fails closed), so the list is the
 * same one the web sidebar shows, and a chat started on either device
 * continues on the other: the eve session id is on the row.
 */
type ChatRow = {
  id: string;
  title: string;
  eve_session_id: string | null;
  last_message_at: string;
  project_id: string | null;
};

const STARTERS = [
  "What needs my attention today?",
  "Summarise this week's blocked work",
  "What did we decide about the freezer SOP?",
];

export default function AssistantScreen() {
  const router = useRouter();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id ?? null;
  const [rows, setRows] = useState<ChatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data, error: err } = await supabase
      .from("assistant_chats")
      .select("id, title, eve_session_id, last_message_at, project_id")
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("last_message_at", { ascending: false })
      .limit(100);
    if (err) setError(err.message);
    else setRows((data ?? []) as ChatRow[]);
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live list: a chat renamed or started elsewhere (web, a scheduled run)
  // appears without a pull-to-refresh. Random topic suffix — a shared topic
  // name crashes on double-mount (see AiThinkingIndicator).
  useEffect(() => {
    if (!propertyId) return;
    const channel = supabase
      .channel(`assistant-chats-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assistant_chats", filter: `property_id=eq.${propertyId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, propertyId]);

  const startChat = async (firstMessage?: string) => {
    if (!propertyId || creating) return;
    setCreating(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("assistant_chats")
      .insert({
        property_id: propertyId,
        user_id: user?.id,
        title: firstMessage?.slice(0, 140) || "New chat",
      })
      .select("id")
      .single();
    setCreating(false);
    if (err || !data) {
      setError(err?.message ?? "Couldn't start a chat");
      return;
    }
    router.push({
      pathname: "/assistant/[chatId]",
      params: { chatId: data.id, ...(firstMessage ? { prefill: firstMessage } : {}) },
    });
  };

  if (!propertyId) return <EmptyState title="Pick a property first" />;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Assistant",
          headerRight: () => (
            <Pressable hitSlop={8} onPress={() => void startChat()} disabled={creating}>
              <Ionicons name="create-outline" size={22} color="#111827" />
            </Pressable>
          ),
        }}
      />
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <Loading label="Loading conversations…" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>What can I help with?</Text>
              <Text style={styles.heroBody}>
                I can see your tasks, documents, calendar and what this
                property has learned — and change them for you.
              </Text>
              <View style={styles.chips}>
                {STARTERS.map((s) => (
                  <Pressable key={s} style={styles.chip} onPress={() => void startChat(s)}>
                    <Text style={styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
              {rows.length > 0 ? <Text style={styles.sectionLabel}>Recent</Text> : null}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                router.push({ pathname: "/assistant/[chatId]", params: { chatId: item.id } })
              }
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color="#6b7280" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.rowMeta}>
                  {new Date(item.last_message_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
          ListEmptyComponent={null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  list: { paddingBottom: 40 },
  hero: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8, gap: 10 },
  heroTitle: { fontSize: 22, fontWeight: "600", color: "#111827" },
  heroBody: { fontSize: 14, lineHeight: 20, color: "#6b7280" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#f3f4f6" },
  chipText: { fontSize: 13, color: "#111827" },
  sectionLabel: {
    marginTop: 18,
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f3f4f6",
  },
  rowTitle: { fontSize: 15, color: "#111827" },
  rowMeta: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  chevron: { fontSize: 20, color: "#d1d5db" },
});
