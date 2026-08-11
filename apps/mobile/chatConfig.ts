// App connection config.
//
// EXPO_PUBLIC_* vars are inlined into the client bundle by Expo, so ONLY public
// values belong here: the Stream API key, the Supabase URL + publishable key,
// and the web API base URL. User tokens are minted at runtime by the backend
// (`/api/stream/token`) — never baked into the bundle.
export const chatApiKey = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? "";

// The Next.js web app, which hosts the Stream token endpoint.
export const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

// Same project as the web app's NEXT_PUBLIC_SUPABASE_* values.
export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
