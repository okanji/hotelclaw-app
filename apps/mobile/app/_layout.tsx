import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ChatWrapper } from "../components/ChatWrapper";
import { AppProvider } from "../contexts/AppContext";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { PropertyProvider } from "../contexts/PropertyContext";

function AuthedStack() {
  const { session, loading } = useAuth();

  // Don't flash the login screen while the persisted session loads.
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ChatWrapper>
      <PropertyProvider>
        <AppProvider>
          <Stack
            screenOptions={{
              // Without this the back chevron is labelled with the previous
              // route's name — literally "(tabs)". react-navigation 7 replaced
              // `headerBackTitleVisible` with this.
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            <Stack.Protected guard={!!session}>
              {/* The tab bar draws its own screen chrome, so the Stack header
                  would double up above it. */}
              <Stack.Screen
                name="(tabs)"
                options={{ headerShown: false, title: "" }}
              />
              <Stack.Screen name="channel/[cid]" />
              <Stack.Screen name="channel/[cid]/thread/[messageId]" />
              <Stack.Screen name="task/[taskId]" />
              <Stack.Screen name="documents" />
              <Stack.Screen name="document/[documentId]" />
            </Stack.Protected>
            <Stack.Protected guard={!session}>
              <Stack.Screen name="login" />
            </Stack.Protected>
          </Stack>
        </AppProvider>
      </PropertyProvider>
    </ChatWrapper>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.container}>
        <AuthProvider>
          <AuthedStack />
        </AuthProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
