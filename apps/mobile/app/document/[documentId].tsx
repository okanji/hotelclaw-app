import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebSurface } from "../../components/WebSurface";
import { EmptyState } from "../../components/ui";
import { usePropertyContext } from "../../contexts/PropertyContext";

/**
 * The real collaborative document editor — Tiptap + Liveblocks — rendered in a
 * WebView (see `WebSurface` for why native is not an option). Fully editable,
 * with live presence and every custom block the web editor supports.
 *
 * NO native stack header here — deliberate, and the result of looking at how
 * document apps actually do this (Notion, Apple Notes, Craft, Bear all use ONE
 * compact static top bar; auto-hiding headers are browser/feed behavior and
 * fight the keyboard while editing). The embedded page already renders a
 * Notion-style bar — title · presence · overflow actions — and in embed mode
 * it grows a native-back chevron (posted to us via `onRequestBack`) while the
 * persistent formatting toolbar hides (globals.css; the selection toolbar
 * still covers formatting, exactly like Notion). Stacking a native header on
 * top of that bar was two headers saying the same thing.
 */
export default function DocumentScreen() {
  const { documentId } = useLocalSearchParams<{ documentId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeProperty } = usePropertyContext();
  const propertyId = activeProperty?.property_id;

  // A cold deep link has no screen to pop back to.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/documents");
  };

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
      <Stack.Screen options={{ headerShown: false }} />
      {/* The WebView is edge-to-edge; only the top needs insetting (the page
          scrolls its own content under the home indicator). */}
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <WebSurface
          path={`/p/${propertyId}/documents/${documentId}`}
          onRequestBack={goBack}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
});
