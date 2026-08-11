import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { FormAttachmentPayload } from "./guards";

/**
 * A form shared into chat (`{type:"form"}` Stream attachment — see web's
 * `components/forms/form-attachment-card.tsx`). Mobile has no form-fill
 * surface, so this is deliberately a read-only card pointing people at the
 * web app rather than a half-built fill flow.
 */
export function FormAttachmentCard({
  attachment,
}: {
  attachment: FormAttachmentPayload;
}) {
  const count = attachment.field_count;
  return (
    <View style={styles.card}>
      <View style={styles.iconPlate}>
        <Text style={styles.icon}>📋</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {attachment.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {attachment.description ||
            (typeof count === "number"
              ? `${count} question${count === 1 ? "" : "s"}`
              : "Form")}
        </Text>
        <Text style={styles.hint}>Open on web to fill out</Text>
      </View>
    </View>
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
    maxWidth: 320,
  },
  iconPlate: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#fef3c7",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 18,
  },
  text: {
    flexShrink: 1,
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
  hint: {
    marginTop: 3,
    fontSize: 11,
    color: "#9ca3af",
  },
});
