import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { supabasePublishableKey, supabaseUrl } from "../chatConfig";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No OAuth redirect URLs land in a native app's "location".
    detectSessionInUrl: false,
  },
});

// Supabase only refreshes tokens while told the app is in the foreground;
// without this, a backgrounded app comes back with an expired session.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
