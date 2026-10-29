import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";

type Checklist = { id: string; name: string; position: number };
type Item = {
  id: string;
  checklist_id: string;
  parent_item_id: string | null;
  text: string;
  done: boolean;
  position: number;
};

/**
 * Per-task checklists (0117) on the phone — the twin of web's
 * ChecklistsPanel, trimmed to what a phone needs: tick items, add an item.
 * Reads + writes go straight to Supabase under RLS (like milestones): the
 * counters, "completed" activity row and workflow event are all DB triggers,
 * so there is no app-side effect an API route would add.
 */
export function TaskChecklists({ propertyId, taskId }: { propertyId: string; taskId: string }) {
  const [lists, setLists] = useState<Checklist[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([
      supabase.from("task_checklists").select("id, name, position").eq("task_id", taskId).order("position"),
      supabase
        .from("task_checklist_items")
        .select("id, checklist_id, parent_item_id, text, done, position")
        .eq("task_id", taskId)
        .order("position"),
    ]);
    setLists((c.data ?? []) as Checklist[]);
    setItems((i.data ?? []) as Item[]);
  }, [taskId]);

  useEffect(() => {
    void Promise.resolve().then(load);
    const channel = supabase
      .channel(`task-checklists-${taskId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_checklists", filter: `task_id=eq.${taskId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "task_checklist_items", filter: `task_id=eq.${taskId}` }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [taskId, load]);

  if (lists.length === 0) return null;

  const toggle = async (item: Item) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    await supabase.from("task_checklist_items").update({ done: !item.done }).eq("id", item.id);
  };

  const add = async (checklist: Checklist) => {
    const text = (drafts[checklist.id] ?? "").trim();
    if (!text) return;
    setDrafts((d) => ({ ...d, [checklist.id]: "" }));
    const last = items
      .filter((i) => i.checklist_id === checklist.id && !i.parent_item_id)
      .reduce((m, i) => Math.max(m, i.position), 0);
    await supabase.from("task_checklist_items").insert({
      checklist_id: checklist.id,
      task_id: taskId,
      property_id: propertyId,
      text,
      position: last + 1024,
    });
    void load();
  };

  return (
    <>
      {lists.map((cl) => {
        const own = items.filter((i) => i.checklist_id === cl.id);
        const top = own.filter((i) => !i.parent_item_id);
        const done = own.filter((i) => i.done).length;
        const row = (i: Item, nested: boolean) => (
          <Pressable
            key={i.id}
            onPress={() => void toggle(i)}
            style={[styles.row, nested && styles.nested]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: i.done }}
          >
            <Ionicons
              name={i.done ? "checkbox" : "square-outline"}
              size={20}
              color={i.done ? "#16a34a" : "#9ca3af"}
            />
            <Text style={[styles.text, i.done && styles.done]}>{i.text}</Text>
          </Pressable>
        );
        return (
          <View key={cl.id} style={styles.section}>
            <Text style={styles.title}>
              {cl.name}
              <Text style={styles.count}> · {done}/{own.length}</Text>
            </Text>
            {top.map((t) => (
              <View key={t.id}>
                {row(t, false)}
                {own.filter((c) => c.parent_item_id === t.id).map((c) => row(c, true))}
              </View>
            ))}
            <View style={styles.row}>
              <Ionicons name="add" size={20} color="#9ca3af" />
              <TextInput
                style={styles.input}
                placeholder="Add an item"
                placeholderTextColor="#9ca3af"
                value={drafts[cl.id] ?? ""}
                onChangeText={(v) => setDrafts((d) => ({ ...d, [cl.id]: v }))}
                returnKeyType="done"
                onSubmitEditing={() => void add(cl)}
              />
            </View>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 2 },
  title: { fontSize: 13, fontWeight: "600", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  count: { fontWeight: "400", textTransform: "none" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  nested: { paddingLeft: 28 },
  text: { flex: 1, fontSize: 15, color: "#111827" },
  done: { color: "#9ca3af", textDecorationLine: "line-through" },
  input: { flex: 1, fontSize: 15, color: "#111827", paddingVertical: 2 },
});
