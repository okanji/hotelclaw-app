import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { AppArtifactAttachment } from "@hotelclaw/chat-ui";

/**
 * Artifact card for `app_artifact` Stream attachments — "the AI is working
 * on this record" (web reference: `components/chat/artifact-card.tsx`).
 * Posted with status "writing" when a bot write starts and upserted to
 * "done" when it lands.
 *
 * Tapping a document artifact opens the mobile document screen
 * (`app/document/[documentId].tsx` — the real collaborative editor in a
 * WebView, so a "writing" doc streams in live there too). Sheets have no
 * native detail screen, so sheet cards render non-tappable.
 */
export function ArtifactCard({
  attachment,
}: {
  attachment: AppArtifactAttachment;
}) {
  const router = useRouter();
  const writing = attachment.status === "writing";
  const isSheet = attachment.kind === "sheet";
  const noun = isSheet ? "Spreadsheet" : "Document";

  const status = writing
    ? attachment.action === "appending"
      ? "AI is adding sections…"
      : "AI is writing…"
    : attachment.action === "created"
      ? `${noun} created`
      : `${noun} updated`;

  const documentId = attachment.document_id;
  const canOpen = !isSheet && typeof documentId === "string";

  const body = (
    <>
      <View style={[styles.iconPlate, isSheet ? styles.plateSheet : styles.plateDoc]}>
        {writing ? (
          <ActivityIndicator size="small" color="#6b7280" />
        ) : (
          <Text style={styles.icon}>{isSheet ? "🧾" : "📄"}</Text>
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {attachment.title}
        </Text>
        <Text style={[styles.subtitle, writing && styles.subtitleWriting]} numberOfLines={1}>
          {status}
        </Text>
      </View>
      {canOpen ? <Text style={styles.chevron}>›</Text> : null}
    </>
  );

  return canOpen ? (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => router.navigate(`/document/${documentId}`)}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.card}>{body}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    padding: 10,
    alignSelf: "flex-start",
    minWidth: 220,
    maxWidth: 320,
  },
  pressed: {
    backgroundColor: "#f9fafb",
  },
  iconPlate: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  plateDoc: {
    backgroundColor: "#dbeafe",
  },
  plateSheet: {
    backgroundColor: "#dcfce7",
  },
  icon: {
    fontSize: 18,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  subtitle: {
    marginTop: 1,
    fontSize: 12,
    color: "#6b7280",
  },
  subtitleWriting: {
    color: "#2563eb",
  },
  chevron: {
    fontSize: 20,
    color: "#9ca3af",
    paddingLeft: 2,
  },
});
