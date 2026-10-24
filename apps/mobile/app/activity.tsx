import { Stack } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ActivityFeed } from "../components/ActivityFeed";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { usePropertyContext } from "../contexts/PropertyContext";
import {
  FAMILIES,
  matchesFamily,
  useActivityLog,
  useActivityLookup,
  type ActivityFamily,
} from "../lib/activity";
import { useApi, type ApiMember } from "../lib/api";
import { useCatalogues } from "../lib/catalogues";

/**
 * Workspace activity — everything that changed across the property and who
 * changed it (the phone twin of Activity → Workspace on the web). Kind chips
 * on top; tapping a row opens the task or project.
 */
export default function WorkspaceActivityScreen() {
  const { session } = useAuth();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;
  const { rows, error, reload } = useActivityLog(propertyId, { kind: "property" });
  const { data: members } = useApi<ApiMember[]>(
    propertyId ? `/api/properties/${propertyId}/members` : null,
  );
  const catalogues = useCatalogues(propertyId);
  const lookup = useActivityLookup(session?.user.id, members, catalogues.projects, catalogues.spaces);
  const [family, setFamily] = useState<ActivityFamily>("all");

  const visible = useMemo(
    () => (rows ?? []).filter((r) => matchesFamily(r, family)),
    [rows, family],
  );

  if (!propertyId) return <EmptyState title="Pick a property first" />;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Activity" }} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipsBar}
      >
        {FAMILIES.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFamily(f.id)}
            style={[styles.chip, family === f.id && styles.chipActive]}
          >
            <Text style={[styles.chipText, family === f.id && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : rows === null ? (
        <Loading label="Loading activity…" />
      ) : (
        <ActivityFeed
          rows={visible}
          lookup={lookup}
          showProject
          onRefresh={() => void reload()}
          refreshing={false}
          emptyTitle={rows.length === 0 ? "No activity yet" : "Nothing in this filter"}
          emptyBody={
            rows.length === 0
              ? "Changes to tasks, projects and milestones will appear here, with who made them."
              : "Try another kind."
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  chipsBar: { flexGrow: 0 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  chipActive: { backgroundColor: "#111827" },
  chipText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  chipTextActive: { color: "#ffffff" },
});
