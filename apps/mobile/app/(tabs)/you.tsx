import { useRouter } from "expo-router";
import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAuth } from "../../contexts/AuthContext";
import { usePropertyContext } from "../../contexts/PropertyContext";

/**
 * Account tab. This is where switching property lives — Slack puts the
 * workspace switcher behind You / a swipe rail rather than the header, because
 * you change workspace rarely and read messages constantly.
 */
export default function YouTab() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const { memberships, activeProperty, setActivePropertyId, loading, error } =
    usePropertyContext();

  const email = session?.user.email ?? "";
  const name =
    (session?.user.user_metadata?.full_name as string | undefined) ?? email;
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  return (
    <View style={styles.container}>
      <ScreenHeader title="You" />
      <FlatList
        data={memberships}
        keyExtractor={(m) => m.property_id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              <View style={styles.identityText}>
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                {email && name !== email ? (
                  <Text style={styles.email} numberOfLines={1}>
                    {email}
                  </Text>
                ) : null}
              </View>
            </View>
            {/* Documents live here rather than in the tab bar: iOS caps at 5
                tabs, and on a phone docs are looked up occasionally while
                chat/tasks/calendar are checked constantly. */}
            <Pressable
              style={styles.linkRow}
              onPress={() => router.push("/documents")}
            >
              <Text style={styles.linkText}>📄  Documents</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>
              {memberships.length > 1 ? "Switch property" : "Property"}
            </Text>
          </>
        }
        renderItem={({ item }) => {
          const isActive = item.property_id === activeProperty?.property_id;
          return (
            <Pressable
              style={[styles.row, isActive && styles.rowActive]}
              onPress={() => setActivePropertyId(item.property_id)}
            >
              <View style={styles.rowText}>
                <Text style={styles.propertyName}>{item.property.name}</Text>
                <Text style={styles.role}>{item.role}</Text>
              </View>
              {isActive ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {loading
              ? "Loading your properties…"
              : (error ??
                "You don't belong to any properties yet. Accept an invite or finish onboarding on the web app.")}
          </Text>
        }
        ListFooterComponent={
          <Pressable style={styles.signOut} onPress={() => void signOut()}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  list: { padding: 16 },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 24,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "600",
  },
  identityText: { flex: 1 },
  name: { fontSize: 17, fontWeight: "600" },
  email: { fontSize: 14, color: "#6b7280", marginTop: 2 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    marginBottom: 20,
  },
  linkText: { fontSize: 16, fontWeight: "500" },
  chevron: { fontSize: 20, color: "#9ca3af" },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    marginBottom: 8,
  },
  rowActive: {
    backgroundColor: "#eef2ff",
  },
  rowText: { flex: 1 },
  propertyName: { fontSize: 16, fontWeight: "600" },
  role: {
    fontSize: 13,
    color: "#6b7280",
    textTransform: "capitalize",
    marginTop: 2,
  },
  check: { fontSize: 18, color: "#2563eb", fontWeight: "700" },
  empty: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
    paddingVertical: 32,
  },
  signOut: { marginTop: 24, paddingVertical: 14, alignItems: "center" },
  signOutText: { color: "#dc2626", fontSize: 16, fontWeight: "600" },
});
