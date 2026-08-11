import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import { WebSurface } from "../../components/WebSurface";
import { EmptyState } from "../../components/ui";
import { usePropertyContext } from "../../contexts/PropertyContext";

/**
 * The real collaborative document editor — Tiptap + Liveblocks — rendered in a
 * WebView (see `WebSurface` for why native is not an option). Fully editable,
 * with live presence and every custom block the web editor supports.
 */
export default function DocumentScreen() {
  const { documentId } = useLocalSearchParams<{ documentId: string }>();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;

  if (!propertyId || !documentId) {
    return (
      <>
        <Stack.Screen options={{ title: "Document" }} />
        <EmptyState title="Document unavailable" />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Document" }} />
      <WebSurface path={`/p/${propertyId}/documents/${documentId}`} />
    </>
  );
}
