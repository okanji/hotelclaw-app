import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Platform, StyleSheet, Text, View } from "react-native";
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

/** "Today" / "Yesterday" for the recent stuff, a short date beyond a week —
 *  "137 days ago" is noise in a list that's mostly archivalia. */
function docDate(iso: string): string {
  const rel = relativeDay(iso);
  if (rel === "Today" || rel === "Yesterday") return rel;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days < 7 && rel) return rel;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The page's own emoji mark when it has one (Notion-style), else a neutral
 *  kind glyph in an inset tile. */
function DocIcon({ doc }: { doc: ApiDocument }) {
  return (
    <View style={styles.iconTile}>
      {doc.icon ? (
        <Text style={styles.iconEmoji}>{doc.icon}</Text>
      ) : (
        <Ionicons
          name={doc.kind === "sheet" ? "grid-outline" : "document-text-outline"}
          size={15}
          color="#6b7280"
        />
      )}
    </View>
  );
}

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
      <Stack.Screen
        options={{
          title: "Documents",
          // Platform-native search instead of a permanently-visible input
          // row: iOS tucks it above the list (pull down to reveal — the
          // Notes/Files pattern), Android puts a magnifier in the app bar.
          // The list gets the reclaimed row.
          headerSearchBarOptions: {
            placeholder: "Search documents",
            autoCapitalize: "none",
            hideWhenScrolling: true,
            onChangeText: (e) => setQuery(e.nativeEvent.text),
          },
          // Large title that collapses on scroll — the standard iOS shape
          // for a browsable index screen. Android ignores it.
          ...(Platform.OS === "ios" ? { headerLargeTitle: true } : null),
        }}
      />
      <View style={styles.container}>
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
            // Lets the native header (large title + search bar) drive the
            // top inset — required for headerSearchBarOptions on iOS.
            contentInsetAdjustmentBehavior="automatic"
            keyboardDismissMode="on-drag"
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
                  {/* Icon tile · (title + meta) over preview — preview
                      indents past the icon so text keeps one left edge. */}
                  <View style={styles.itemRow}>
                    <DocIcon doc={item} />
                    <View style={styles.itemBody}>
                      <View style={styles.bar}>
                        <Text style={styles.title} numberOfLines={1}>
                          {item.title || "Untitled"}
                        </Text>
                        {item.updated_at ? (
                          <Text style={styles.meta} numberOfLines={1}>
                            {docDate(item.updated_at)}
                          </Text>
                        ) : null}
                      </View>
                      {item.body_text ? (
                        <Text style={styles.preview} numberOfLines={2}>
                          {item.body_text.slice(0, 200)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
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
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  iconTile: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  iconEmoji: { fontSize: 15 },
  itemBody: { flex: 1, minWidth: 0 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: { fontSize: 16, fontWeight: "500", flex: 1, minWidth: 0 },
  meta: {
    fontSize: 12,
    color: "#9ca3af",
    fontVariant: ["tabular-nums"],
  },
  preview: { fontSize: 14, color: "#6b7280", marginTop: 3, lineHeight: 19 },
});
