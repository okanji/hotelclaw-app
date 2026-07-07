# hotelclaw mobile (Expo + Stream Chat)

The React Native app, part of the turborepo at the repo root (sibling: the
Next.js web app at `apps/web`). v1 surface: **Stream Chat** (channels, messages,
threads). Tasks come next.

## Stack

- **Expo SDK 56**, React Native 0.85, **New Architecture** (required by Stream).
- **Expo Router** (file-based routing under `app/`). Entry is `expo-router/entry`.
- **stream-chat-expo** for all chat UI.
- pnpm workspace with `node-linker=hoisted` (see root `.npmrc`) — required so
  Metro resolves native modules. `metro.config.js` watches the workspace root.

## Read the real docs first

Expo and Stream both ship breaking changes between versions. Before writing code:
- Expo: https://docs.expo.dev/versions/v56.0.0/
- Stream Chat Expo tutorial: https://getstream.io/chat/sdk/react-native/tutorial/expo/

## Run

This app ships native code, so it runs on a **dev client**, not Expo Go:

```bash
pnpm dev:mobile            # from repo root — expo start (dev client)
# first build of the native project:
cd apps/mobile && npx expo run:ios      # or run:android (needs Xcode / Android Studio)
```

## Layout

```
app/
  _layout.tsx                         # SafeArea > GestureHandlerRootView > ChatWrapper > AppProvider > Stack
  index.tsx                           # ChannelList
  channel/[cid].tsx                   # Channel + MessageList + MessageComposer
  channel/[cid]/thread/[messageId].tsx# Thread
components/ChatWrapper.tsx            # useCreateChatClient + OverlayProvider + Chat
contexts/AppContext.tsx              # selected channel + active thread
chatConfig.ts                        # reads EXPO_PUBLIC_STREAM_* env
custom-types.d.ts                    # Stream custom-data module augmentation
```

## Conventions (from the Stream RN skill RULES — non-negotiable)

- One `Chat` + `OverlayProvider` near the root (`ChatWrapper`), above navigation.
- Use `useCreateChatClient`; never construct `StreamChat` in a screen body.
- Babel: `react-native-worklets/plugin` must be the **last** plugin.
- Navigate with channel **cid** params, not `Channel` instances; recreate the
  `Channel` from `useChatContext().client` on the destination screen.
- On a channel screen under a native header, pass the header height as BOTH
  `keyboardVerticalOffset` and `topInset` on `Channel`.

## Credentials

`chatConfig.ts` reads `EXPO_PUBLIC_STREAM_*` from `.env.local` (gitignored). The
public API key is shared with web (`NEXT_PUBLIC_STREAM_API_KEY`). The **API
secret never goes in this app** — dev tokens only; production tokens come from a
backend token provider.
