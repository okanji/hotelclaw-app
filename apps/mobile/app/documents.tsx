import { Stack, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { fadeUpEntering } from "../components/AiLoader";
import {
  EmptyState,
  ErrorState,
  Loading,
  Row,
  relativeDay,
} from "../components/ui";
import { usePropertyContext } from "../contexts/PropertyContext";
import { useApi, type ApiDocument } from "../lib/api";

export default function DocumentsScreen() {
  const router = useRouter();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;
  const [query, setQuery] = useState("");

  const { data, loading, error, refetch } = useApi<ApiDocument[]>(
    propertyId ? `/api/properties/${propertyId}/documents` : null,
  );

  // The list route already returns body_text for up to 50 docs, so filtering
  // (and the reader itself) needs no extra round-trip.
  const docs = useMemo(() => {
    const all = data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.body_text ?? "").toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <>
      <Stack.Screen options={{ title: "Documents" }} />
      <View style={styles.container}>
        <TextInput
          style={styles.search}
          placeholder="Search documents"
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : docs.length === 0 ? (
          <EmptyState
            icon={query ? "search" : "document-text-outline"}
            title={query ? "No matches" : "No documents"}
            body={query ? undefined : "Documents created on web show up here."}
          />
        ) : (
          <FlatList
            data={docs}
            keyExtractor={(d) => d.id}
            refreshing={loading}
            onRefresh={refetch}
            renderItem={({ item, index }) => (
              <Animated.View entering={fadeUpEntering(index)}>
                <Row
                  onPress={() =>
                    // navigate (not push) so a double-tap can't stack the screen
                    router.navigate({
                      pathname: "/document/[documentId]",
                      params: { documentId: item.id },
                    })
                  }
                >
                  {/* Card-bar anatomy (ContextCards): icon · title · meta,
                      preview body below. */}
                  <View style={styles.bar}>
                    <Text style={styles.kindIcon}>
                      {item.kind === "sheet" ? "▦" : "📄"}
                    </Text>
                    <Text style={styles.title} numberOfLines={1}>
                      {item.title || "Untitled"}
                    </Text>
                    {item.updated_at ? (
                      <Text style={styles.meta} numberOfLines={1}>
                        {relativeDay(item.updated_at) ?? ""}
                      </Text>
                    ) : null}
                  </View>
                  {item.body_text ? (
                    <Text style={styles.preview} numberOfLines={2}>
                      {item.body_text.slice(0, 200)}
                    </Text>
                  ) : null}
                </Row>
              </Animated.View>
            )}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  search: {
    margin: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    fontSize: 16,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  kindIcon: { fontSize: 14 },
  title: { fontSize: 16, fontWeight: "500", flex: 1, minWidth: 0 },
  meta: {
    fontSize: 12,
    color: "#9ca3af",
    fontVariant: ["tabular-nums"],
  },
  preview: { fontSize: 14, color: "#6b7280", marginTop: 4 },
});
