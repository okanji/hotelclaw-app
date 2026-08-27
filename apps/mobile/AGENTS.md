# hotelclaw mobile (Expo + Stream Chat)

The React Native app, part of the turborepo at the repo root (sibling: the
Next.js web app at `apps/web`). v1 surface: **Stream Chat** (channels, messages,
threads). Tasks come next.

## Stack

- **Expo SDK 57**, React Native 0.86, **New Architecture** (required by Stream).
  Upgraded from SDK 56 on 2026-08-17 to pick up the fixed Hermes V1 (the
  bundled Hermes in SDK 56 / RN 0.85 has a known memory regression).
- **Expo Router** (file-based routing under `app/`). Entry is `expo-router/entry`.
- **stream-chat-expo** for all chat UI.
- pnpm workspace with `node-linker=hoisted` (see root `.npmrc`) — required so
  Metro resolves native modules. `metro.config.js` watches the workspace root.

## Read the real docs first

Expo and Stream both ship breaking changes between versions. Before writing code:
- Expo: https://docs.expo.dev/versions/v57.0.0/
- Stream Chat Expo tutorial: https://getstream.io/chat/sdk/react-native/tutorial/expo/

## Run

This app ships native code, so it runs on a **dev client**, not Expo Go:

```bash
pnpm dev:mobile            # from repo root — expo start (dev client)
# first build of the native project:
cd apps/mobile && npx expo run:ios      # or run:android (needs Xcode / Android Studio)
```

## Ship / update (iOS via EAS + TestFlight, OTA via EAS Update — set up 2026-08-27)

Two release paths; pick by what changed:

- **JS/TS-only change** (screens, styling, logic — most changes): pushing to
  main auto-publishes OTA via `.github/workflows/eas-update.yml` (repo secret
  `EXPO_TOKEN`; path-filtered to apps/mobile + the chat-grouping/chat-ui
  workspace packages). Manual equivalent, no Apple involved, live on next app
  launch:
  ```bash
  cd apps/mobile
  env $(grep EXPO_TOKEN .env.local) NODE_OPTIONS=--no-network-family-autoselection \
    eas update --channel production --message "<what changed>"
  ```
- **Native change** (new native module, SDK upgrade, permissions, app.json
  native config): full build + TestFlight cycle, both non-interactive (ASC API
  key lives on EAS servers):
  ```bash
  eas build --platform ios --profile production --non-interactive
  eas submit --platform ios --latest --non-interactive
  ```
  TestFlight auto-updates installed apps after Apple processes (~10 min).

Wiring: `expo-updates` installed; `runtimeVersion: {policy: "appVersion"}` +
`updates.url` in app.json; per-profile `channel` in eas.json (production /
preview / development). **The appVersion policy means an OTA update only
reaches builds with the same `version` in app.json** — bump the version ⇒
old builds stop receiving updates until they install the new binary.
`EXPO_TOKEN` is in `.env.local` (gitignored; eas-cli does not auto-read it —
inject via `env $(grep …)`). Run all eas commands **from `apps/mobile`** — a
repo-root run scaffolds a stray new EAS project. ASC App ID 6805854542;
EAS project `@okanjis-team/hotelclaw` (44766015-c288-4987-a593-e89d6c625f41).

## Layout

```
app/
  _layout.tsx                         # SafeArea > GestureHandler > AuthProvider > ChatWrapper > PropertyProvider > AppProvider > Stack (Stack.Protected auth guard)
  login.tsx                           # email+password sign-in (Supabase)
  (tabs)/_layout.tsx                  # NativeTabs bottom bar: Channels / DMs / Tasks / Calendar / You
  (tabs)/index.tsx                    # Channels (type "team"), scoped to active property
  (tabs)/dms.tsx                      # DMs (type "messaging"), same scoping
  (tabs)/tasks.tsx                    # task list (My / Open / All) + new-task sheet
  (tabs)/calendar.tsx                 # 30-day agenda, read-only
  (tabs)/you.tsx                      # account + Documents link + property switcher + sign out
  channel/[cid].tsx                   # Channel + MessageList + MessageComposer
  channel/[cid]/thread/[messageId].tsx# Thread
  task/[taskId].tsx                   # task detail: complete, status, priority, assignee
  documents.tsx                       # document list + search
  document/[documentId].tsx           # read-only document (body_text)
components/ChannelListPane.tsx        # the shared channel list (filters + tenant guards)
components/ScreenHeader.tsx           # compact nav bar for tab screens (NativeTabs has no header)
components/ui.tsx                     # Loading / ErrorState / EmptyState, status+priority ramps
components/ChatWrapper.tsx            # useCreateChatClient w/ backend tokenProvider
lib/api.ts                            # Bearer-authed calls into the web API + useApi hook
contexts/AuthContext.tsx             # Supabase session (AsyncStorage-persisted)
contexts/PropertyContext.tsx         # memberships + active property (tenant)
contexts/AppContext.tsx              # selected channel + active thread
lib/supabase.ts                      # supabase-js client (AsyncStorage, AppState refresh)
chatConfig.ts                        # reads EXPO_PUBLIC_* env (all public values)
custom-types.d.ts                    # Stream custom-data module augmentation
```

## Auth & tenancy

- Sign-in is Supabase email+password (same `auth.users` as web). Session
  persists in AsyncStorage; `Stack.Protected` in `_layout.tsx` gates all
  screens behind it.
- Stream tokens are minted by the web app: `GET /api/stream/token` with
  `Authorization: Bearer <supabase access token>`. Mobile tokens carry a 12h
  expiry; `ChatWrapper` passes a provider function so Stream re-fetches on
  expiry. `EXPO_PUBLIC_API_URL` points at the web app.
- Tenancy: `PropertyContext` loads the user's `memberships` (RLS-gated,
  filtered to self — see the gotcha in `apps/web/lib/auth/session.ts`), and the
  channel list filters on `property_id` + `frozen: false`, mirroring
  `apps/web/components/chat/channel-list/channel-list-section.tsx`.
  The self-filter is load-bearing, not defensive: without it this account sees
  25 membership rows instead of its own 8.
- **Navigation follows Slack's mobile model**: a bottom tab bar (Channels /
  DMs / You). **Switching property lives in the You tab**, not the header —
  you change org rarely and read messages constantly, so the switcher gets no
  prime space. Two earlier attempts were wrong: a bare `⇄` glyph (unreadable as
  a control) and then a header title button + a full-width segment row (too
  prominent, ate list space).
- The Channels header shows the property name as **plain text, not a control** —
  it tells you which org you're in, the way Slack titles Home with the
  workspace name.
- **Header actions are an icon pill, not text buttons** (Apple Calendar's
  pattern): view-type / search / + grouped in one rounded `#f3f4f6` pill on the
  right. Search is collapsed behind its icon and expands to a full-width bar
  over the header when tapped, so it costs a row only while in use. Tasks and
  Calendar both use this. Icons are `@expo/vector-icons` (Ionicons) — font
  based, so adding it needed **no** native rebuild (expo-font is already in the
  build); SF Symbols are only available to `NativeTabs`, not arbitrary views.
- **Channels vs DMs** are one query with a different Stream channel type
  (`team` vs `messaging`), matching web's two `ChannelListSection`s — shared by
  `components/ChannelListPane.tsx`, one tab each. DMs are property-scoped too
  (the DM channel carries `property_id`), so a DM in another property appears
  only after switching to it. Creating a DM is still web-only.
- A deep link into `channel/[cid]` can point at another property. The screen
  reads the channel's `property_id` and switches the active property to match
  when you're a member, and refuses to render when you aren't.
- **Scoping is client-side only.** A valid user token can still query
  cross-property channels straight against Stream (verified: 30 channels
  unscoped vs 2–5 scoped). Locking that down means Stream channel-type
  permissions — not done yet.

## Tasks / Calendar / Documents

These surfaces talk to the **web app's property API** (`lib/api.ts`, Bearer
auth), not straight to Postgres. That is deliberate for WRITES: task create and
update run the shared `lib/tasks/mutations.ts` on the server, so mobile gets the
same assignment notifications, background triage, and top-of-column positioning
as web. A direct Supabase insert would fire the DB triggers (workflow
automations) but silently skip all three.

- `GET/POST /api/properties/:id/tasks`, `GET/PATCH .../tasks/:taskId`,
  `GET .../calendar?from&to`, `GET .../documents`, `GET .../members` all accept
  cookie **or** Bearer via `lib/auth/api-caller.ts`.
- The calendar route already returns a unified feed (meetings + scheduled tasks
  + bookings + connected external calendars), so the agenda needs no merging.
- Task filtering lives in `lib/task-filters.ts` (pure), mirroring **every** web
  board facet — search, status, priority, assignee, creator, team, project,
  label, due bucket, source, and custom fields (0080) — including the exact
  `taskDueBuckets` arithmetic and the OR-within / AND-across semantics.
  Facet catalogues (teams, projects, custom fields + values) come from
  `lib/catalogues.ts`, read straight from Supabase under RLS: they're
  side-effect-free reference reads, unlike writes, which must go through the
  shared mutation layer.
- The calendar is a real calendar: list + compact month views, search, event
  detail, and create/edit/delete via `/api/properties/:id/meetings`, which runs
  the same `saveMeetingFor` as the web dialog. Only `source: "meeting"` events
  are editable — tasks, bookings and external-calendar events are owned by
  other surfaces.
  Native date/time pickers come from `@react-native-community/datetimepicker`
  (native module — adding it required a rebuild).

## Documents are the real editor, in a WebView

`components/WebSurface.tsx` renders a page from the web app inside the native
shell. `document/[documentId]` points it at
`/p/<pid>/documents/<id>` — so mobile gets Tiptap + Liveblocks collaboration,
presence, and every custom block, fully editable, with no second editor to
maintain.

**Viewport is PINNED in the shell (2026-08-27):** the injected script rewrites
the viewport meta to `maximum-scale=1, user-scalable=no` on DOMContentLoaded —
without it WKWebKit auto-zooms the whole page when a tap focuses editable text
under 16px ("tap a doc and it zooms"), plus double-tap smart-zoom. This is the
Notion-app behavior; it's scoped to the WebView so real browsers keep
pinch/accessibility zoom. A MutationObserver re-applies the pin because Next's
metadata reconciler can rewrite the tag on client-side navigations.

**The doc screen has NO native stack header (2026-08-27)** — Notion/Apple
Notes/Craft all use ONE compact static top bar, and we had three (native
header + in-page breadcrumb row + formatting toolbar). In embed mode the
editor's own top row (title · presence · ⋯ overflow) IS the bar: it grows a
back chevron (`EmbedBackButton` in `document-breadcrumbs.tsx`, doc + sheet
editors) that posts `{type:"back"}` — handled by `WebSurface.onMessage` →
`onRequestBack` — and the persistent formatting toolbar hides (the selection
FloatingToolbar still covers formatting). The screen pads `insets.top` itself.
**Embed CSS rules must be UNLAYERED in globals.css**: the top bar/toolbar
carry Tailwind's `flex` utility, and a `display:none` inside `@layer base`
loses to the utilities layer — the original hamburger-hide rule had regressed
this way, silently visible in the app. Auto-hide-on-scroll was considered and
rejected: it's browser/feed behavior, no document app does it, and it fights
the keyboard while editing.

The Documents LIST screen is native: iOS large title + native
`headerSearchBarOptions` (pull down to reveal; magnifier in the app bar on
Android), per-doc emoji icons (`documents.icon` now returned by the list API),
short dates, previews.

**This is not laziness, it's the only option.** ProseMirror requires a browser
DOM (contenteditable + DOM observers), so Tiptap cannot run natively in RN, and
Liveblocks' React Native support covers presence/storage only — there is no RN
text editor. Every alternative (`@10play/tentap-editor` et al) is also a WebView,
just with a *different* Tiptap that would have none of our nodes.

Auth: the WebView has no cookies but the app has a Bearer session, so
`WebSurface` POSTs `/api/auth/mobile-session` (Bearer) for a ONE-TIME
magic-link hash and injects it with `injectedJavaScriptBeforeContentLoaded`;
`/auth/mobile-bridge` (web) exchanges it via `verifyOtp` for a cookie session
OF ITS OWN, then redirects. The hash goes through injected JS, never a query
param — a URL would leak it into server logs, Referer, and history. `/auth`
is already in the middleware's public allowlist.

**Never hand the WebView the native refresh token** (the original design).
Supabase rotates refresh tokens as a family: the bridged web client refreshed
the shared token, the native app's copy became a stale ancestor, and its next
refresh tore the family down — the app signed itself out just because a
document had been opened (caught live in the 2026-08-18 smoke test). The
one-time-hash design gives the WebView an independent session family; the
bridge keeps a legacy `setSession` fallback only for outdated app builds.

**Token containment (2026-08-17):** the injected script runs on EVERY
main-frame navigation in the WebView, at any origin — so two layers keep the
session tokens on our origin: the script only defines the global when
`location.origin` matches the API origin, and `onShouldStartLoadWithRequest`
refuses off-origin main-frame navigations (external links open in the system
browser; iframes for doc embeds pass through). Don't loosen either layer —
before them, tapping any external link inside a document handed the page both
Supabase tokens.
- `EXPO_PUBLIC_API_URL` must point at a running web server or every one of these
  screens shows its error state.

## Failure states are load-bearing here

Three screens can only fail by hanging, so each one must surface the error and
offer a way out. Regressions here look exactly like a slow network:

- `ChatWrapper` — `useCreateChatClient` leaves the client `null` forever if the
  token mint fails, and it wraps the navigator, so a bad `EXPO_PUBLIC_API_URL`
  strands the whole app on a spinner. It now shows the failing endpoint with
  Retry / Sign out, and names the URL after 8s of silence.
- `channel/[cid]` — a rejected `watch()` (deleted channel, non-member) used to
  spin forever; it now renders an error with Go back. The thread screen has the
  same guard, plus a cold-deep-link path that loads the parent message by the
  route's `messageId` (`client.getMessage` + `formatMessage`) — without it a
  thread link into a cold app could never render. Both screens also only adopt
  the AppContext channel when its cid matches the route param, so a warm deep
  link can't show another channel's messages under the linked URL.
- `PropertyContext` — a failed memberships fetch used to render as "No
  properties yet", which reads as an account problem. It now carries a distinct
  `error` + `reload()`.

## Conventions (from the Stream RN skill RULES — non-negotiable)

- One `Chat` + `OverlayProvider` near the root (`ChatWrapper`), above navigation.
- Use `useCreateChatClient`; never construct `StreamChat` in a screen body.
- Babel: `react-native-worklets/plugin` must be the **last** plugin.
- Navigate with channel **cid** params, not `Channel` instances; recreate the
  `Channel` from `useChatContext().client` on the destination screen.
- On a channel screen under a native header, pass the header height as BOTH
  `keyboardVerticalOffset` and `topInset` on `Channel`.
- **The AI thinking row is DB-driven, not Stream typing.**
  `components/AiThinkingIndicator.tsx` mirrors web's: it watches
  `channel_bot_sessions.turn_state` (+ `channel_bot_activity` steps) over
  Supabase Realtime, because eve turns run 30s–minutes while Stream expires
  typing after seconds. Root (`_root`) conversations only; softens to "Still
  working on it…" after 25s. Realtime topics get a random suffix — a shared
  topic name crashes on double-mount.
  It mounts via `additionalFlatListProps.ListHeaderComponent`: the RN list is
  **inverted**, so that slot is the visual BOTTOM, matching where web portals
  its row. The SDK owns that slot for the typing indicator and
  `additionalFlatListProps` is spread AFTER it, so the typing indicator is
  re-rendered there explicitly — dropping it would silently undo human typing
  indicators.
- **Never nest a horizontal ScrollView inside the message list.** On the RN
  new architecture, a `<ScrollView horizontal>` inside Stream's inverted
  `MessageList` grows to unbounded height: the cell ballooned to fill the
  viewport invisibly and pushed the rest of the channel history off screen —
  every "ghost message" in the 2026-08-18 smoke test traced back to ONE
  3-column `ai_ui` DataTable rendered through it. `AiUiAttachment` now lays
  out every table with flex cells + wrapping text instead; keep it that way,
  and apply the same rule to any future custom attachment renderer.
- **Message clustering is SHARED with web**, not reimplemented:
  `@hotelclaw/chat-grouping` (pure, dependency-free, unit-tested in
  `apps/web/lib/chat/__tests__/message-grouping.test.ts`) holds the rules —
  2-minute gap, one `eve_turn` = one cluster, and no cluster break for
  attachments/reactions. `lib/message-grouping.ts` adapts it to the RN API
  (`getMessageGroupStyle`), which differs in two ways: RN passes date
  separators as `dateSeparatorDate` params instead of injecting rows (they must
  become cluster breaks), and it wants `GroupStyle[]` rather than one role.
  Pass BOTH `getMessageGroupStyle` and `maxTimeBetweenGroupedMessages` on
  `Channel`, on the thread screen too. These rules have drifted twice; a second
  implementation would guarantee a third.
- SDK 56+: `Tabs` from the expo-router root export is **deprecated**. Use
  `NativeTabs` from `expo-router/unstable-native-tabs` — a real UIKit tab bar
  that takes SF Symbols via `<NativeTabs.Trigger.Icon sf="…" />`, so it needs no
  icon package (this app has no `@expo/vector-icons`). It rides on
  react-native-screens, already in the native build — no rebuild to adopt it.

## Android (first supported 2026-08-24)

The app builds and runs on Android via EAS (`eas build -p android --profile
preview` → installable APK; config in `eas.json`, package
`com.hotelclaw.mobile`). The 2026-08-24 emulator smoke test against PROD
verified login, Stream connect, property-scoped channel list, the message
list (history + ai_ui tables render — the no-horizontal-ScrollView rule
holds on Android too), Tasks/Calendar/You, deep links, and the document
WebView through the one-time-hash auth bridge. Two Android-specific forks
exist — keep them when touching these files:

- **Tab bar**: `app/(tabs)/_layout.tsx` is platform-forked. On Android,
  `NativeTabs` renders ONLY THE ACTIVE TRIGGER (four of five tabs simply
  missing) and SF Symbols don't exist — Android uses the classic JS `Tabs`
  with Ionicons instead. iOS keeps NativeTabs.
- **Date/time pickers**: `@react-native-community/datetimepicker` is a
  DIALOG on Android, not a view — rendering it inline mounts the dialog
  immediately. `EventFormSheet`'s `PickerField` shows a tappable value chip
  on Android and opens the dialog on demand; iOS keeps the inline compact
  picker.

## Credentials

`chatConfig.ts` reads `EXPO_PUBLIC_*` from `.env.local` (gitignored) — see
`.env.example`. All values are public (Stream API key, Supabase URL +
publishable key, web API base URL). The **API secret and service-role key never
go in this app**; user tokens are minted at runtime by `/api/stream/token`.
