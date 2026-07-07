// Stream Chat connection config.
//
// EXPO_PUBLIC_* vars are inlined into the client bundle by Expo, so ONLY put the
// public Stream API key and a (dev) user token here — never the API secret. In
// production the user token must be minted by your backend / token provider.
export const chatApiKey = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? "";
export const chatUserId = process.env.EXPO_PUBLIC_STREAM_USER_ID ?? "";
export const chatUserName =
  process.env.EXPO_PUBLIC_STREAM_USER_NAME ?? chatUserId;
export const chatUserToken = process.env.EXPO_PUBLIC_STREAM_USER_TOKEN ?? "";
