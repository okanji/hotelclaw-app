# Porting the Documents feature

A comprehensive, file-by-file guide to lifting the document editor out of this
app and into another project.

The feature is a **Notion-style block editor**: Tiptap v3 for editing,
**Liveblocks + Yjs** for real-time collaboration and comments, the **Vercel AI
SDK** for AI assist, and **Supabase** (Postgres + Storage) for persistence and
files. At edit time the Yjs CRDT is the source of truth; a Liveblocks
`ydocUpdated` webhook snapshots the doc back into Postgres so the rest of the
app (search, list views, AI) can read plain text/JSON without touching Yjs.

> Architecture note baked into the code: **the first node of the document IS
> the title** (Notion model). Its text is mirrored into `documents.title` via
> the `renameDocument` server action, so the sidebar tree / list / 404 lookups
> never parse Yjs. Keep this model or you'll have to rework the header, tree,
> and breadcrumbs.

---

## 0. Data flow (read this first)

```
        ┌─────────────── browser ───────────────┐
        │  Tiptap editor (document-editor.tsx)   │
        │  + useLiveblocksExtension()  ──────────┼──► Liveblocks room
        │  + custom nodes / slash menu           │     (Yjs doc = truth)
        └────────────────────────────────────────┘            │
                          ▲                                    │ ydocUpdated
        room id: property:<id>:doc:<id>                        ▼  webhook
                          │                          app/api/liveblocks/webhook
   app/api/liveblocks/auth │  (validates membership)  → lib/documents/snapshot.ts
                          │                                    │
                          ▼                                    ▼
                 Liveblocks server SDK            documents.body_state (Yjs bytea)
                 (lib/liveblocks/server.ts)       documents.body_text / body_json
                                                  documents.body_updated_at
                                                            │
                       AI / search / list views read body_text & body_json
```

Three planes to port: **(A)** the editor + blocks (client), **(B)** the
collaboration plane (Liveblocks rooms, auth, webhook→snapshot), **(C)** the
data plane (Supabase tables, queries, server actions, file storage). AI assist
is a fourth, optional plane layered on top.

---

## 1. Editor core

| Path | What it does |
|------|--------------|
| `components/documents/document-editor.tsx` | The editor. Assembles the Tiptap extension list, mounts the Liveblocks `RoomProvider`, wires the AI toolbar, comment threads, breadcrumbs, header, and the AI panel. This is the spine — start here. |
| `components/documents/document-composer.tsx` | Comment composer wrapper (`ComposerCloseContext`, `DocumentComposer`) for inline threads. |
| `components/documents/document-header.tsx` | Title row + icon/cover, share, labels, history entry points. |
| `components/documents/document-breadcrumbs.tsx` | Ancestor breadcrumb trail (reads the docs tree). |
| `components/documents/document-presence-stack.tsx` | `DocumentRoomAvatarStack` — live collaborator avatars in the room. |
| `app/documents-editor.css` | Prose, block, selection, and placeholder styling for the editor body. |
| `components/documents/document-drag-handle.css` | Styling for the global block drag handle. |

**Extension list** assembled in `document-editor.tsx` (all `@tiptap/* ^3`):
`StarterKit`, `Highlight`, `Image`, `Link`, `TaskList`, `TextAlign`,
`Typography`, `Youtube`, `Table`/`TableRow`/`TableHeader`/`TableCell`,
`CodeBlockLowlight` (+ `lowlight` `common` registry, `highlight.js`
`github-dark` theme), `Placeholder`, plus `useLiveblocksExtension()` from
`@liveblocks/react-tiptap`, plus the app's custom nodes (§2), `SlashCommand`,
`SubPage`, `BlockReorder`, and `SpaceForAi`.

---

## 2. Custom blocks (node schema ↔ React view)

Each block is a Tiptap **node definition** in `lib/documents/nodes/` paired with
a **React node view** in `components/documents/nodes/`.

| Node definition | React view | Block |
|-----------------|-----------|-------|
| `lib/documents/nodes/callout.ts` | `components/documents/nodes/callout-view.tsx` | Callout (5 tones + emoji icon) |
| `lib/documents/nodes/toggle.ts` | `components/documents/nodes/toggle-view.tsx` | Collapsible toggle (open-state synced via Yjs) |
| `lib/documents/nodes/file-attachment.ts` | `components/documents/nodes/file-attachment-view.tsx` | File / PDF attachment (Supabase `documents-files`) |
| `lib/documents/nodes/embed.ts` | `components/documents/nodes/embed-view.tsx` | URL bookmark / oEmbed card |
| `lib/documents/nodes/spreadsheet-embed.ts` | `components/documents/nodes/spreadsheet-embed-view.tsx` | Google Sheets / Excel Online iframe |
| `lib/documents/nodes/chart.ts` | `components/documents/nodes/chart-view.tsx` (+ `chart-data-editor.tsx`) | Bar/line/area/pie chart via recharts |
| `components/documents/sub-page-node.tsx` | *(self-contained)* | Inline sub-page (nested document) |

Supporting block logic:

| Path | What it does |
|------|--------------|
| `lib/documents/url-embeds.ts` | `detectEmbed()` — URL pattern matching (YouTube/Vimeo/Loom/Figma/Twitter/Spotify/CodePen) with og:meta fallback. |
| `lib/documents/block-reorder.ts` | `BlockReorder` extension — drag-handle reordering glue. |

### Adding a new block (the 3-step contract — keep this if you extend)
1. Register the node in the `GlobalDragHandle` `customNodes` array in
   `document-editor.tsx` so the hover drag handle picks it up.
2. Add a slash-menu entry in `slash-command.tsx` with a `section`.
3. If the **AI bot** should be allowed to author it, extend `ALLOWED_TAGS` +
   `ATTR_ALLOWLIST` in `lib/ai/bots/doc-bot.ts` and update the
   `propose_document_content` tool description.

---

## 3. Slash command / block palette

| Path | What it does |
|------|--------------|
| `components/documents/slash-command.tsx` | The `/` insert menu — sections (AI, Basic, Blocks, Media), block transforms, sub-page creation. Uses `@tiptap/suggestion`. |
| `tiptap-extension-global-drag-handle` (npm) | Hover drag handle on every block; configured in `document-editor.tsx`. |

---

## 4. Collaboration plane (Liveblocks + Yjs)

This is the load-bearing, most-coupled part. Port it carefully.

| Path | What it does |
|------|--------------|
| `lib/liveblocks/room-provider.tsx` | `LiveblocksProvider` — `authEndpoint`, `resolveUsers`, `resolveMentionSuggestions`. Wraps the app. |
| `lib/liveblocks/rooms.ts` | Room-id scheme: `roomIdForDocument()`, `parseDocumentRoomId()`, `propertyIdFromRoomId()`. **Pattern: `property:<propertyId>:doc:<documentId>`.** |
| `lib/liveblocks/server.ts` | `getLiveblocksServer()` singleton (Liveblocks node SDK); `deletePropertyRooms()` cleanup. |
| `lib/liveblocks/resolvers.ts` | `resolveUsers` / `resolveMentionSuggestions` — fetch profile name/avatar for the cursor & mention UI. |
| `lib/liveblocks/use-prewarm-document.ts` | Preconnect to a room before navigation to hide connection latency. |
| `app/api/liveblocks/auth/route.ts` | **Session auth.** Validates that the caller may access the room (membership check) and issues a Liveblocks token. The tenant boundary lives here — rewrite for your permission model. |
| `app/api/liveblocks/webhook/route.ts` | Receives `ydocUpdated`/storage webhooks → calls `persistDocumentSnapshot`. |
| `lib/documents/snapshot.ts` | `captureDocumentSnapshot()` (Yjs → text/JSON via `@liveblocks/node-prosemirror`), `persistDocumentSnapshot()` (writes `body_state`/`body_text`/`body_json`/`body_updated_at`). |
| `app/api/properties/[propertyId]/documents/presence/route.ts` | Batch "who's active" across docs, polled by list/home surfaces. |

**Liveblocks CSS** (imported in the docs layout, required for the floating
toolbar/threads/composer to look right):
`@liveblocks/react-ui/styles.css`, `.../styles/dark/attributes.css`,
`@liveblocks/react-tiptap/styles.css`.

**Env:** Liveblocks secret key (server) + public key (client), webhook signing
secret. Configure the `ydocUpdated` webhook in the Liveblocks dashboard to point
at `/api/liveblocks/webhook`.

---

## 5. AI assist plane (optional but comprehensive here)

Two distinct AI surfaces: a **doc-scoped chat bot** (proposes whole-block edits)
and an **inline contextual rewrite** (Liveblocks AI Toolkit — rewrite/insert at
the selection).

| Path | What it does |
|------|--------------|
| `lib/ai/bots/doc-bot.ts` | The document bot: persona, tools (`get_document`, `list_doc_threads`, `propose_document_content`), and the **HTML allowlist** (`ALLOWED_TAGS`/`ATTR_ALLOWLIST`) that bounds what the bot may write. Runs via the app's shared `runBot()`. |
| `lib/ai/doc-contextual.ts` | Inline rewrite/insert backend for the floating AI toolbar — **not** `runBot()`; returns `{ type: "insert" \| "replace", text }`. |
| `components/documents/document-ai-panel.tsx` | The bottom AI dock: persistent multi-chat, chat switcher, message history. Exposes `DocumentAiPanelHandle`. |
| `components/documents/doc-ai-suggestions.tsx` | `DocAiSuggestions` — staged-suggestion tiles. |
| `components/documents/ai-review-bar.tsx` | Floating inline diff bar (red/green) to accept/reject staged edits. |
| `lib/documents/ai-suggestion.ts` | `AiSuggestion` class — stages, applies, and rejects proposed edits against the editor. |
| `lib/documents/pending-generation.ts` | Tracks an in-flight AI generation (spinner / placeholder block). |
| `lib/documents/normalize-doc-html.ts` | Sanitizes HTML and strips the title before handing the doc to the model (uses DOMPurify). |
| `lib/documents/space-for-ai.ts` | `SpaceForAi` extension — surfaces surrounding-space context to the bot. |

**AI API routes:**

| Path | What it does |
|------|--------------|
| `app/api/properties/[propertyId]/documents/[documentId]/ai/route.ts` | One bot turn: loads chat history, runs `runDocBot`, persists the proposed edit. |
| `app/api/properties/[propertyId]/documents/[documentId]/ai/contextual/route.ts` | Inline rewrite/insert; calls `lib/ai/doc-contextual.ts`. |
| `app/api/properties/[propertyId]/documents/[documentId]/ai/chats/route.ts` | List / create chats for a document. |
| `app/api/properties/[propertyId]/documents/[documentId]/ai/chats/[chatId]/route.ts` | Get / delete a single chat. |

**Env / coupling:** model ids and provider keys (this app uses
`@ai-sdk/anthropic`, with `@ai-sdk/openai` / `@ai-sdk/xai` available). The bot
relies on the app's shared `runBot()` in `lib/ai/run-bot.ts` (gbrain tools,
delegate, temperature/stop settings auto-injected). If you don't port the bot
runtime, replace `runDocBot` with a direct `generateText`/`streamText` call.

---

## 6. Data plane — queries, actions, types, utilities

| Path | What it does |
|------|--------------|
| `lib/documents/queries.ts` | `getDocuments`, `getDocumentsTree`, board reads — RLS-gated Supabase selects used by the layout prefetch and surfaces. |
| `components/documents/actions.ts` | Server actions: `createDocument` (sparse-float positioning), `renameDocument` (title mirror), `archiveDocument`, restore, move, icon/cover. |
| `components/documents/board-actions.ts` | Board CRUD server actions (`createBoard`, `addDocToBoard`, …). |
| `lib/documents/search.ts` | Full-text search helpers over `body_text`/`sheet_text`. |
| `lib/documents/document-href.ts` | Canonical URL builder for a document. |
| `lib/documents/presence.ts` | `uniquePresenceUsers()` — dedupe presence avatars. |
| `lib/documents/use-member-name.ts` | Resolve a display name by user id. |
| `lib/documents/use-open-document.ts` | Navigation/open helper (warm-cache aware). |
| `lib/documents/use-pinned-docs.ts` | Query hook for pinned docs. |
| `lib/documents/build-activity.ts` | Builds the per-doc activity history. |
| `lib/documents/activity-sparkline.ts` | Sparkline series for the docs home. |

**Query-layer coupling:** the editor reads the open doc's title + ancestors out
of the React Query cache via `lib/query/section-queries.ts`
(`documentsTreeQueryOptions`, `DocumentTreeRow`) and `notFound()`s on a miss.
Cache keys: `["documents", propertyId]`, `["documents-tree", propertyId]`. You
must port (or re-create) these cache keys and the `getServerQueryClient`
prefetch in the layout, or the editor will 404 on hard loads.

---

## 7. API routes — CRUD, files, embeds, boards, search

| Path | What it does |
|------|--------------|
| `app/api/properties/[propertyId]/documents/route.ts` | List active documents. |
| `app/api/properties/[propertyId]/documents/search/route.ts` | Full-text search endpoint. |
| `app/api/properties/[propertyId]/document-boards/route.ts` | Board CRUD. |
| `app/api/documents/files/upload/route.ts` | Multipart upload → `documents-files` bucket (50 MB, broad MIME allowlist: PDF/audio/video/office). |
| `app/api/documents/images/upload/route.ts` | Image upload → `documents-images` bucket (10 MB, images only). |
| `app/api/documents/og-preview/route.ts` | Scrapes og: metadata (title/description/image/siteName) for bookmark embeds. |

---

## 8. Pages & rendering surface

This app routes documents oddly: every `page.tsx` under the docs route is
`null`; rendering is owned one level up by the property layout's
`<DocumentsSurface>` so cross-section rail clicks are `pushState`s. The docs
**layout** only does the server prefetch + Liveblocks CSS imports. Simplify this
if your app doesn't use a persistent rail.

| Path | What it does |
|------|--------------|
| `app/p/[propertyId]/documents/layout.tsx` | Server prefetch of `["documents"]` + `["documents-tree"]` into the React Query cache; imports all Liveblocks/Tiptap CSS. |
| `app/p/[propertyId]/documents/page.tsx` | Docs home route (renders via surface). |
| `app/p/[propertyId]/documents/[documentId]/page.tsx` | Document detail route (renders via surface). |
| `app/p/[propertyId]/documents/loading.tsx`, `[documentId]/loading.tsx` | Loading skeletons. |
| `app/p/[propertyId]/documents/error.tsx` | Error boundary. |
| `components/documents/documents-surface.tsx` | Reads the active doc from the URL; renders the editor or the home/list. |
| `components/documents/documents-home.tsx` | Docs home: boards carousel + list. |

---

## 9. Home / list / metadata surface (the surrounding app shell)

Not required to edit a document, but part of "comprehensive." Port if you want
the full Notion-like experience.

**List & navigation**
- `components/documents/document-list.tsx`, `document-list-skeleton.tsx`, `document-row.tsx`
- `components/documents/documents-tree-section.tsx` — sidebar tree
- `components/documents/document-search.tsx`
- `components/documents/create-document-dialog.tsx`
- `components/documents/generate-document-dialog.tsx` — AI "generate a doc"
- `components/documents/archived-documents-dialog.tsx` — restore archived

**Boards (sticky-note grouping)**
- `components/documents/doc-boards-section.tsx`, `doc-boards-board.tsx`, `doc-pin-card.tsx`

**Metadata & detail panels**
- `components/documents/document-labels.tsx` — tags
- `components/documents/document-last-edited.tsx`
- `components/documents/document-history.tsx` — version history (Liveblocks)
- `components/documents/document-share.tsx` — sharing/permissions
- `components/documents/document-linked-tasks.tsx`, `document-task-item.tsx` — task backlinks (app-specific; drop if no tasks)
- `components/documents/document-thread-indicator.tsx` — inline comment indicator
- `components/documents/activity-sparkline.tsx`, `docs-activity-panel.tsx`, `docs-home-presence.tsx`

---

## 10. Database (Supabase migrations)

These migrations build the schema incrementally — **squash them into one** when
porting. Listed in apply order with the columns/objects each adds.

| Migration | Adds |
|-----------|------|
| `0009_documents.sql` | `documents` table (id, property_id, title, created_by, archived_at), `documents-images` storage bucket, base RLS. |
| `0012_documents_nesting.sql` | `parent_id`, `position` (sparse-float), tree RLS, `archive_document_tree()` / `restore_document_tree()` functions. |
| `0013_document_boards.sql` | `document_boards`, `document_board_items` (sticky-note model). |
| `0014_documents_body_snippet.sql` | `body_snippet` for list previews. |
| `0015_documents_last_edited_by.sql` | `last_edited_by`. |
| `0019_documents_body_snapshot.sql` | **`body_state` (Yjs bytea), `body_text`, `body_json`, `body_updated_at`** — the webhook snapshot columns. Core. |
| `0020_documents_search_rpc.sql` | Full-text search RPC over `body_text`. |
| `0024_documents_sheet_kind.sql` | `kind` (doc/sheet), `sheet_state` (JSON), `sheet_text` (TSV), `sheet_updated_at`; extends FTS to sheets. |
| `0031_doc_ai_chats.sql` | `doc_ai_chats`, `doc_ai_messages` (persistent multi-chat + edit JSON). |
| `0034_documents_files_bucket.sql` | `documents-files` storage bucket (50 MB, broad MIME allowlist). |
| `0037_documents_icon_cover.sql` | `icon`, `cover_image` (Notion-style). |
| `0042_space_pinned_resources.sql` | `space_pinned_resources` (pin a doc to a space overview — app-specific). |

**Minimum table for editing** (`documents`): `id, property_id, parent_id,
position, kind, title, icon, cover_image, body_state, body_text, body_json,
body_updated_at, body_snippet, created_by, last_edited_by, archived_at`.

Storage buckets to create: **`documents-images`**, **`documents-files`** (with
RLS matching your tenancy).

Realtime: enable the Supabase Realtime publication on `documents`,
`doc_ai_chats`, `doc_ai_messages` if you want live list/chat updates.

---

## 11. npm dependencies

**Tiptap (v3):** `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`,
`@tiptap/starter-kit`, `@tiptap/extensions`, `@tiptap/suggestion`,
`@tiptap/extension-link`, `-image`, `-list`, `-table`, `-table-row`,
`-table-header`, `-table-cell`, `-text-align`, `-highlight`, `-typography`,
`-youtube`, `-code-block-lowlight` · `tiptap-extension-global-drag-handle`

**Code highlighting:** `lowlight`, `highlight.js`

**Liveblocks:** `@liveblocks/client`, `@liveblocks/react`,
`@liveblocks/react-tiptap`, `@liveblocks/react-ui`, `@liveblocks/node`,
`@liveblocks/node-prosemirror` · **CRDT:** `yjs`

**AI (optional):** `ai`, `@ai-sdk/anthropic` (+ `@ai-sdk/openai`,
`@ai-sdk/xai`, `@ai-sdk/react`)

**Data/storage:** `@supabase/supabase-js`, `@supabase/ssr`, `xlsx` (sheets),
`@tanstack/react-query`

**UI/blocks:** `recharts` (chart block), `dompurify` (HTML sanitize),
`lucide-react`, `@emoji-mart/react` + `@emoji-mart/data` (callout/icon picker),
`sonner`, `diff` (inline AI diff), `nanoid`, `clsx` + `tailwind-merge`,
`class-variance-authority`. Editor prose styling assumes
`@tailwindcss/typography`.

---

## 12. What you must rewire (app-specific coupling)

1. **Tenancy / RLS.** Everything is scoped by `property_id` and gated by
   `public.is_member(property_id)`. The Liveblocks room id encodes it
   (`property:<id>:doc:<id>`) and `app/api/liveblocks/auth/route.ts` enforces
   it. Replace `propertyId` with your scoping key in: `rooms.ts`, the auth
   route, every query/action, and every API route path.
2. **Supabase client helpers.** `lib/supabase/server.ts` / `client.ts` and
   `lib/auth/session.ts` (`requireUser`) are imported throughout. Swap for your
   DB/auth layer or keep Supabase.
3. **Storage buckets.** Create `documents-images` + `documents-files` with RLS;
   the upload routes hardcode bucket names and limits.
4. **User profiles.** Collaborator avatars/names come from a `profiles` table
   via `lib/liveblocks/resolvers.ts` and the auth route. Adapt to your user
   schema.
5. **React Query cache keys / prefetch.** `["documents", propertyId]` and
   `["documents-tree", propertyId]`, prefetched in the docs layout and read by
   the editor (`lib/query/section-queries.ts`). The editor `notFound()`s
   without the tree warm.
6. **Rendering indirection.** This app renders docs from a property-layout
   surface with `null` pages for rail `pushState`. If you don't have a
   persistent rail, render the editor directly from
   `[documentId]/page.tsx` and delete `documents-surface.tsx`.
7. **AI runtime.** `lib/ai/bots/doc-bot.ts` calls the shared `runBot()`
   (`lib/ai/run-bot.ts`) which auto-injects gbrain/delegate tools and uniform
   settings. If you don't port that runtime, replace `runDocBot` with a plain
   `generateText`/`streamText` call.
8. **App-specific extras to drop if unused.** `document-linked-tasks.tsx` /
   `document-task-item.tsx` (tasks), `WorkflowProvenanceBadge` (workflows),
   `space-for-ai.ts` / `space_pinned_resources` (spaces), meetings/labels links.

---

## 13. Suggested port order

1. **Schema** — squash the §10 migrations; create the two buckets.
2. **Collaboration plane** — `lib/liveblocks/*`, the auth route, the
   webhook→`snapshot.ts`. Verify a room connects and snapshots land in
   `body_state`/`body_text`.
3. **Editor core + blocks** — §1 + §2 + §3; get a single doc editing
   collaboratively.
4. **Data plane** — `queries.ts`, `actions.ts`, the CRUD/upload/og routes, the
   React Query keys + layout prefetch.
5. **Pages/surface** — wire `[documentId]/page.tsx` to the editor.
6. **AI plane** (optional) — §5.
7. **Home/list/metadata** (optional) — §9.
