"use client";

/**
 * Collaborative document editor — Tiptap + Liveblocks. Modeled on the upstream
 * example at:
 *   https://github.com/liveblocks/liveblocks/tree/main/examples/nextjs-tiptap-advanced
 *
 * Phase 1 only — no AI features yet.
 *
 * Title model: Notion-style. The first node of the document IS the title.
 * Its text is mirrored into `documents.title` via the `renameDocument` server
 * action so the sidebar tree, list view, and 404 lookups don't need to parse
 * Yjs. `initialContent` seeds the first-ever opener with `<h1>{title}</h1>` so
 * the doc starts with a sensible placeholder; subsequent openers get the
 * already-synced Yjs content.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ClientSideSuspense,
  RoomProvider,
  useThreads,
} from "@liveblocks/react/suspense";
import {
  AiToolbar,
  AnchoredThreads,
  FloatingComposer,
  FloatingThreads,
  FloatingToolbar,
  Toolbar,
  useIsEditorReady,
  useLiveblocksExtension,
} from "@liveblocks/react-tiptap";
import Highlight from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TaskList } from "@tiptap/extension-list";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import Youtube from "@tiptap/extension-youtube";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import "highlight.js/styles/github-dark.css";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorView } from "@tiptap/pm/view";
import { HelpCircle, Loader2, Sparkles } from "lucide-react";
import { roomIdForDocument } from "@/lib/liveblocks/rooms";
import {
  documentsTreeQueryOptions,
  type DocumentTreeRow,
} from "@/lib/query/section-queries";
import { renameDocument } from "./actions";
import {
  DocumentAiPanel,
  type DocumentAiPanelHandle,
} from "./document-ai-panel";
import { DocumentLastEdited } from "./document-last-edited";
import { DocumentLinkedTasks } from "./document-linked-tasks";
import { DocumentRoomAvatarStack } from "./document-presence-stack";
import {
  DocumentBreadcrumbs,
  type DocumentCrumb,
} from "./document-breadcrumbs";
import { ComposerCloseContext, DocumentComposer } from "./document-composer";
import { DocAiSuggestions } from "./doc-ai-suggestions";
import { AiReviewBar } from "./ai-review-bar";
import { DocumentHistory } from "./document-history";
import { AiSuggestion } from "@/lib/documents/ai-suggestion";
import { DocumentTaskItem } from "./document-task-item";
import {
  DocumentFloatingThread,
  DocumentThreadIndicator,
  ThreadIndicatorEditorContext,
} from "./document-thread-indicator";
import { SlashCommand } from "./slash-command";
import { SubPage } from "./sub-page-node";
import { BlockReorder } from "@/lib/documents/block-reorder";
import { Callout } from "@/lib/documents/nodes/callout";
import { Toggle as ToggleNode } from "@/lib/documents/nodes/toggle";
import { FileAttachment } from "@/lib/documents/nodes/file-attachment";
import { Embed } from "@/lib/documents/nodes/embed";
import { SpreadsheetEmbed } from "@/lib/documents/nodes/spreadsheet-embed";
import { Chart } from "@/lib/documents/nodes/chart";
import "./document-drag-handle.css";
import { takePendingGeneration } from "@/lib/documents/pending-generation";

const TITLE_SYNC_DEBOUNCE_MS = 600;
const TITLE_MAX_LENGTH = 200;

// Shared lowlight registry for the code-block extension. `common` is a
// curated ~37-language set (js, ts, py, sh, html, css, json, sql, yaml,
// markdown, etc.) — enough for hotel-ops snippets without bundling the
// full 190-language list. Lives at module scope so we don't rebuild the
// registry on every editor mount.
const lowlight = createLowlight(common);
// Body persistence is server-driven now: the Liveblocks `ydocUpdated`
// webhook captures a snapshot (binary + plaintext + JSON) per room per
// ~60s — see app/api/liveblocks/webhook/route.ts. No client-side
// debounce hits Postgres on the body anymore.

/**
 * Document editor entry point. The title + breadcrumb ancestors are derived
 * from the shared `["documents-tree", propertyId]` cache — warm from the rail
 * prefetch and kept fresh by `DocumentsTreeSection`'s realtime — instead of a
 * blocking server fetch, so the page's RSC stays trivial and the route
 * transition is instant. A document missing from the tree (archived, or in
 * another property) is a 404.
 */
export function DocumentEditor({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  // `isLoading` (= pending with no data yet) — not `isPending`. Hydrated
  // server data can be `isFetching` on mount; treating that as loading left
  // the editor stuck after a hard refresh.
  const { data: tree, isLoading, isError } = useQuery({
    ...documentsTreeQueryOptions(propertyId),
    retry: 2,
  });

  if (isLoading) return <EditorSkeleton />;
  // Query errored — keep the skeleton up while react-query retries. Falling
  // through to `notFound()` here would 404 the user out on a transient blip.
  if (isError && !tree) return <EditorSkeleton />;
  if (!tree) return <EditorSkeleton />;

  const row = tree.find((d) => d.id === documentId);
  if (!row) notFound();

  const ancestors = ancestorsOf(tree ?? [], row);

  return (
    <RoomProvider
      id={roomIdForDocument(propertyId, documentId)}
      initialPresence={{
        cursor: null,
        selectedTaskId: null,
        draggingTaskId: null,
        editingEventId: null,
        focusedDay: null,
        selectedCell: null,
        selectionRange: null,
        activeSheetId: null,
      }}
    >
      <ClientSideSuspense fallback={<EditorSkeleton />}>
        <EditorInner
          propertyId={propertyId}
          documentId={documentId}
          initialTitle={row.title}
          lastEditedBy={row.last_edited_by}
          updatedAt={row.updated_at}
          ancestors={ancestors}
        />
      </ClientSideSuspense>
    </RoomProvider>
  );
}

/** Walks `doc`'s parent chain to the top, building breadcrumb crumbs. */
function ancestorsOf(
  tree: DocumentTreeRow[],
  doc: DocumentTreeRow,
): DocumentCrumb[] {
  const byId = new Map(tree.map((d) => [d.id, d]));
  const crumbs: DocumentCrumb[] = [];
  const seen = new Set<string>();
  let cursor = doc.parent_id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    crumbs.unshift({ id: node.id, title: node.title });
    cursor = node.parent_id;
  }
  return crumbs;
}

function EditorSkeleton() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading document…
    </div>
  );
}

function EditorInner({
  propertyId,
  documentId,
  initialTitle,
  lastEditedBy,
  updatedAt,
  ancestors,
}: {
  propertyId: string;
  documentId: string;
  initialTitle: string;
  lastEditedBy: string | null;
  updatedAt: string;
  ancestors: DocumentCrumb[];
}) {
  const isReady = useIsEditorReady();
  const [syncTimedOut, setSyncTimedOut] = useState(false);

  // If Liveblocks never reaches `synchronizing`, don't block forever — but
  // give the websocket a few seconds first (auth + Yjs handshake).
  useEffect(() => {
    setSyncTimedOut(false);
    if (isReady) return;
    const t = setTimeout(() => setSyncTimedOut(true), 12_000);
    return () => clearTimeout(t);
  }, [documentId, isReady]);

  const liveblocks = useLiveblocksExtension({
    // Only applied when the Yjs doc is brand new (first opener wins). Seeds
    // the title heading so the page never opens to a totally blank canvas.
    initialContent: `<h1>${escapeHtml(initialTitle)}</h1><p></p>`,
    // Persist Yjs state in IndexedDB. A previously-opened doc renders from
    // the local snapshot the instant you reopen it; remote deltas reconcile
    // in the background. The Liveblocks offline-support docs
    // require that no Liveblocks hook outside `useLiveblocksExtension` /
    // `useEditor` triggers a loading screen — that's why threads have been
    // moved into their own `ClientSideSuspense` boundary instead of
    // suspending the whole editor.
    offlineSupport_experimental: true,
    // Inline AI Toolkit (the floating "Ask AI" toolbar + suggestion menu).
    // `resolveContextualPrompt` routes to our own doc-contextual endpoint —
    // WITHOUT it, the extension silently falls back to Liveblocks' hosted AI.
    // It MUST resolve a single `{ type, text }` (no streaming); the server
    // decides insert-vs-replace from whether there's a selection. Setting
    // `ai` auto-enables permanentUserData (needed for the review-phase diff).
    ai: {
      name: "Claw AI",
      resolveContextualPrompt: async ({ prompt, context, previous, signal }) => {
        const res = await fetch(
          `/api/properties/${propertyId}/documents/${documentId}/ai/contextual`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // `context` = { beforeSelection, selection, afterSelection }.
            // `previous.response` is the prior `{ type, text }` on a "Try
            // again" refinement (Liveblocks wraps it in { prompt, response }).
            body: JSON.stringify({
              prompt,
              context,
              previous: previous?.response,
            }),
            signal, // Escape/cancel aborts the controller → aborts this fetch.
          },
        );
        if (!res.ok) throw new Error(`AI request failed (${res.status})`);
        return (await res.json()) as {
          type: "insert" | "replace" | "other";
          text: string;
        };
      },
    },
  });

  const editor = useEditor({
    immediatelyRender: false,
    // Validate prosemirror content against the schema. When an old doc
    // contains a node type a newer schema doesn't recognise (e.g. we add
    // Callout, then somebody opens a doc authored with Callout in a build
    // where Callout has been removed), Tiptap would silently break Yjs sync
    // without this. The handler logs and lets Tiptap drop the unknown
    // nodes — better than a hard error or a corrupted document.
    enableContentCheck: true,
    onContentError({ error }) {
      console.warn("[document-editor] schema mismatch", error);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-none",
      },
      handlePaste(view, event) {
        return handleImageFiles(view, event.clipboardData?.files, propertyId, documentId);
      },
      handleDrop(view, event) {
        if (!(event instanceof DragEvent)) return false;
        return handleImageFiles(view, event.dataTransfer?.files, propertyId, documentId);
      },
    },
    extensions: [
      liveblocks,
      StarterKit.configure({
        // Liveblocks owns undo/redo via Yjs — disabling the bundled history
        // prevents diverging local-vs-remote stacks.
        undoRedo: false,
        // StarterKit ships its own Link extension; disable it here so the
        // explicit `Link.configure({ openOnClick: false })` below is the
        // sole registration. Two extensions sharing the `link` name fires a
        // recurring Tiptap warning and can race during initial editor
        // mount (which is exactly when the readiness gate matters).
        link: false,
        // StarterKit's plain CodeBlock is replaced by CodeBlockLowlight
        // below for syntax highlighting. Disabling here prevents two
        // extensions sharing the `codeBlock` node name.
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      Highlight,
      Image,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        // First node is the title; everything below is body. Hint accordingly.
        placeholder: ({ editor, node }) =>
          editor.state.doc.firstChild === node ? "Untitled" : "",
      }),
      DocumentTaskItem,
      TaskList,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Typography,
      Youtube.configure({ modestBranding: true }),
      // Notion-style nested pages: the `subPage` block + the `/` slash menu
      // that creates a child document and inserts the block in one step.
      SubPage,
      SlashCommand.configure({ propertyId, documentId }),
      // Inline AI diff: renders proposed edits as reviewable red/green marks
      // (see lib/documents/ai-suggestion.ts) accepted/rejected via AiReviewBar.
      AiSuggestion,
      // Native tables. Resizable columns; header row support. Rendered with
      // ProseMirror's default table view (no custom React view needed — the
      // editor's `prose` styles + a few overrides in globals make it look
      // close enough to Notion's table.)
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // Code block with syntax highlighting via lowlight. Replaces
      // StarterKit's plain CodeBlock (disabled above). The github-dark
      // theme is imported at the top of this file.
      CodeBlockLowlight.configure({ lowlight }),
      // Notion-style colored callout. Inline content only (no nested blocks),
      // editable like any other paragraph. Variant/icon in Yjs attrs.
      Callout,
      // Collapsible toggle (chevron + summary + hidden body). Open/closed
      // state is synced via Yjs attr so collaborators see the same fold.
      ToggleNode,
      // Non-image file attachments. Uploaded via /api/documents/files/upload
      // (Supabase Storage bucket `documents-files`). Renders as a download
      // card; PDFs get an inline preview.
      FileAttachment,
      // Generic URL embed (YouTube/Vimeo/Loom/Figma/Twitter/Spotify/CodePen
      // + bookmark fallback). Detection in lib/documents/url-embeds.ts;
      // bookmark fallback uses /api/documents/og-preview for metadata.
      Embed,
      // Google Sheets / Excel Online iframe. Edit happens in the provider's
      // UI; we just render the embed.
      SpreadsheetEmbed,
      // Inline chart with editable data grid. Stored as JSON attrs; rendered
      // with recharts (bar/line/area/pie). See lib/documents/nodes/chart.ts.
      Chart,
      // Notion-style rail-locked block reorder. Pointer-driven (not HTML5
      // drag), so the drag preview stays in the block's column and tracks
      // only vertical position. Implementation:
      // lib/documents/block-reorder.ts. Title and empty paragraphs are
      // excluded from both source and target candidates.
      BlockReorder,
    ],
  });

  useTitleSync(editor, documentId);

  // Liveblocks still down after the timeout — seed the title locally so the
  // page isn't a blank canvas (remote content will merge when WS recovers).
  useEffect(() => {
    if (!editor || isReady || !syncTimedOut) return;
    if (editor.state.doc.textContent.trim() !== "") return;
    editor.commands.setContent(
      `<h1>${escapeHtml(initialTitle)}</h1><p></p>`,
    );
  }, [editor, isReady, syncTimedOut, initialTitle]);

  const liveTitle = useLiveTitle(editor, initialTitle);
  const closeComposer = useCallback(() => {
    if (!editor) return;
    closePendingCommentChain(editor);
  }, [editor]);
  useFloatingEditorUIDismiss(editor);

  // "Explain" is a read action, not an edit — route it to the bottom AI dock
  // (quoting the current selection, or the whole doc when nothing's selected)
  // instead of the inline edit pipeline that would stage the answer into the
  // document body.
  const aiPanelRef = useRef<DocumentAiPanelHandle>(null);
  const handleExplain = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selection =
      from === to ? "" : editor.state.doc.textBetween(from, to, "\n");
    aiPanelRef.current?.explain(selection);
  }, [editor]);

  // "Generate doc from a prompt": the dialog stashed a brief keyed by this doc
  // id and navigated here. Once the editor is ready, consume it (once) and ask
  // the AI panel to draft the body — it lands as a staged suggestion in the
  // existing review pipeline. `take*` deletes the entry so a reload won't
  // re-fire generation.
  const generationFired = useRef(false);
  useEffect(() => {
    if (generationFired.current || !editor) return;
    if (!isReady && !syncTimedOut) return;
    const brief = takePendingGeneration(documentId);
    if (!brief) return;
    generationFired.current = true;
    const t = setTimeout(() => aiPanelRef.current?.generate(brief), 300);
    return () => clearTimeout(t);
  }, [editor, isReady, syncTimedOut, documentId]);

  if (!editor) return <EditorSkeleton />;

  // Wait for Yjs before revealing content — `initialContent` and remote
  // document bytes are only applied once the provider is synchronizing.
  // Fall through after a timeout so a flaky websocket doesn't brick the page.
  const showContent = isReady || syncTimedOut;
  if (!showContent) return <EditorSkeleton />;

  return (
    // Light mode: match the chat canvas, which is white (Stream paints
    // `--str-chat__background-core-app` → `chrome-0` → `#ffffff`). Dark mode
    // keeps `--background` as before.
    <div className="relative flex h-full min-h-0 flex-col bg-white dark:bg-background">
      {/* Top row: breadcrumbs (left) + document metadata (right). Keeping
          "Edited by" / History / presence up here lets the formatting toolbar
          below stay a single slim band. */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border/60 bg-muted/20 px-6 py-1.5">
        <DocumentBreadcrumbs
          propertyId={propertyId}
          ancestors={ancestors}
          currentTitle={liveTitle}
        />
        <div className="flex shrink-0 items-center gap-2.5">
          <DocumentLastEdited
            propertyId={propertyId}
            lastEditedBy={lastEditedBy}
            updatedAt={updatedAt}
            className="hidden text-xs text-muted-foreground tabular-nums md:block"
          />
          <DocumentLinkedTasks
            propertyId={propertyId}
            documentId={documentId}
          />
          <DocumentHistory editor={editor} />
          <DocumentRoomAvatarStack max={5} size={24} />
        </div>
      </div>
      <div className="documents-toolbar flex shrink-0 items-center justify-center border-b border-border/60 bg-muted/40 px-6 py-1">
        {/* Default Liveblocks toolbar content, rebuilt so the AI section uses
            OUR "Explain" (→ bottom dock) instead of the built-in one that runs
            through the inline edit pipeline. */}
        <Toolbar editor={editor}>
          <Toolbar.SectionHistory />
          <Toolbar.Separator />
          <DocAiToolbarSection editor={editor} onExplain={handleExplain} />
          <Toolbar.Separator />
          <Toolbar.BlockSelector />
          <Toolbar.SectionInline />
          <Toolbar.Separator />
          <Toolbar.SectionCollaboration />
        </Toolbar>
      </div>
      <div className="flex-1 overflow-auto px-6 pb-24">
        <AiReviewBar editor={editor} />
        <ThreadIndicatorEditorContext.Provider value={editor}>
          <div className="relative mx-auto w-full max-w-3xl pt-16">
            <EditorContent editor={editor} />
            {/* `before` prepends our AI section to the selection toolbar while
                keeping the default formatting controls. "Ask Claw AI" opens the
                inline AI prompt (edit pipeline); "Explain" routes the selection
                to the bottom dock as a read-only answer. */}
            <FloatingToolbar
              editor={editor}
              before={
                <DocAiToolbarSection editor={editor} onExplain={handleExplain} />
              }
            />
            {/* The floating AI toolbar itself — self-portals, renders only
                while an AI prompt is active. `suggestions` customizes the
                "asking"-phase menu (Accept/Try-again/Discard are built in). */}
            <AiToolbar editor={editor} suggestions={<DocAiSuggestions />} />
            <ComposerCloseContext.Provider value={closeComposer}>
              <FloatingComposer
                editor={editor}
                components={{ Composer: DocumentComposer }}
                style={{ width: 350 }}
              />
            </ComposerCloseContext.Provider>
            {/* Threads live in their own Suspense boundary (per the
                Liveblocks offline-support guide) — `useThreads` would
                otherwise block the editor render until threads load, which
                defeats the whole "show cached content instantly" point. The
                editor renders without the overlays for a moment, then the
                thread indicators pop in. */}
            <ClientSideSuspense fallback={null}>
              <EditorThreads editor={editor} />
            </ClientSideSuspense>
          </div>
        </ThreadIndicatorEditorContext.Provider>
      </div>
      <DocumentAiPanel
        ref={aiPanelRef}
        propertyId={propertyId}
        documentId={documentId}
        editor={editor}
      />
    </div>
  );
}

/**
 * AI section for both the main toolbar and the floating selection toolbar.
 * Mirrors Liveblocks' built-in `Toolbar.SectionAi` (Ask + Explain) but points
 * "Explain" at our bottom dock — Explain answers a question about the text, so
 * it should never run through the inline insert/replace edit pipeline.
 */
function DocAiToolbarSection({
  editor,
  onExplain,
}: {
  editor: Editor;
  onExplain: () => void;
}) {
  return (
    <>
      <Toolbar.Button
        name="Ask Claw AI"
        icon={<Sparkles className="size-4" />}
        onClick={() => editor.chain().focus().askAi().run()}
      >
        Ask Claw AI
      </Toolbar.Button>
      <Toolbar.Button
        name="Explain"
        icon={<HelpCircle className="size-4" />}
        onClick={onExplain}
      >
        Explain
      </Toolbar.Button>
    </>
  );
}

/**
 * Inline + gutter thread overlays. Lives in its own `ClientSideSuspense`
 * boundary so `useThreads` (which suspends until threads load) doesn't block
 * the editor from rendering cached content immediately.
 */
function EditorThreads({ editor }: { editor: Editor | null }) {
  const { threads } = useThreads();
  if (!editor) return null;
  return (
    <>
      <FloatingThreads
        threads={threads}
        editor={editor}
        components={{ Thread: DocumentFloatingThread }}
      />
      {/* Gutter indicators (right side, lg+). On narrower viewports the
          inline FloatingThreads popover is the only entry-point — same
          approach as Liveblocks's marketing demo. */}
      <AnchoredThreads
        editor={editor}
        threads={threads}
        components={{ Thread: DocumentThreadIndicator }}
        className="documents-anchored-threads pointer-events-none absolute left-full top-0 ml-6 hidden lg:block"
      />
    </>
  );
}

/**
 * Watches the editor for changes to the first node's text content and mirrors
 * it (debounced) to `documents.title`. The sidebar tree subscribes to
 * Supabase realtime on the `documents` table, so the rename propagates to
 * every connected client without any extra plumbing.
 */
function useTitleSync(editor: Editor | null, documentId: string) {
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSent = "";

    function currentTitle(): string {
      const first = editor!.state.doc.firstChild;
      if (!first) return "";
      return first.textContent.trim().slice(0, TITLE_MAX_LENGTH);
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const next = currentTitle() || "Untitled document";
        if (next === lastSent) return;
        lastSent = next;
        const res = await renameDocument(documentId, next);
        if ("error" in res) {
          // Silently swallow — the sync is best-effort. If the user has
          // network trouble the title can lag the doc, but the doc itself
          // is fine (Yjs handles its own retries).
          console.warn("document title sync failed:", res.error);
        }
      }, TITLE_SYNC_DEBOUNCE_MS);
    }

    editor.on("update", schedule);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("update", schedule);
    };
  }, [editor, documentId]);
}

/**
 * Live mirror of the first node's text for the header breadcrumb. Separate
 * from `useTitleSync` (which is debounced + writes to Postgres): the crumb
 * should track every keystroke, not lag 600ms behind.
 */
function useLiveTitle(editor: Editor | null, initialTitle: string): string {
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => {
    if (!editor) return;
    function read() {
      const first = editor!.state.doc.firstChild;
      setTitle(first?.textContent.trim() || "Untitled");
    }
    read();
    editor.on("update", read);
    return () => {
      editor.off("update", read);
    };
  }, [editor]);
  return title;
}

/**
 * `closePendingComment` is exposed by Liveblocks's CommentsExtension at
 * runtime but isn't included in the public ChainedCommands type — cast so TS
 * lets us through. Helper so the call site stays readable.
 */
function closePendingCommentChain(editor: Editor) {
  (
    editor.chain() as unknown as {
      closePendingComment: () => { run: () => void };
    }
  )
    .closePendingComment()
    .run();
}

/**
 * Outside-click dismissal for BOTH Liveblocks editor popovers:
 *  - `FloatingComposer` (new-comment input) — dismissed via `closePendingComment`
 *  - `FloatingThreads` (existing-thread viewer) — dismissed via `selectThread(null)`
 *
 * Liveblocks's components don't ship an outside-click handler for either
 * (see `FloatingComposer.js` and `CommentsExtension.js` — only Escape and
 * submit close them). The earlier "sometimes works" was incidental: clicking
 * inside the editor changes the selection, which the CommentsExtension
 * clears the pending mark from, which hides the composer. Clicks on the
 * sidebar/toolbar/chrome don't touch the editor selection, so the popovers
 * stay open forever without help.
 *
 * Strategy:
 *  - `window` + capture-phase listeners so no descendant can `stopPropagation`
 *    us out of the picture.
 *  - Listen to BOTH `pointerdown` and `mousedown`. Pointerdown fires earliest;
 *    some Radix synthetic events only emit mousedown.
 *  - "Inside" detection uses class lookups, which is robust here because both
 *    LB popovers carry the shared `.lb-tiptap-floating` class on their portal
 *    root (see `FloatingComposer.js:112`). Mention/emoji pickers carry
 *    `.lb-tiptap-suggestions` and must NOT dismiss either.
 *  - Short-circuit when no popover is mounted: avoids firing useless transactions.
 */
function useFloatingEditorUIDismiss(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return;

    function isInsideEditorPopover(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;
      if (target.closest(".lb-tiptap-floating")) return true; // composer + threads
      if (target.closest(".lb-tiptap-suggestions")) return true; // mention/emoji picker
      return false;
    }

    function dismissIfOutside(event: Event) {
      if (isInsideEditorPopover(event.target)) return;

      // Bail when nothing's open — keeps unrelated clicks completely free of
      // Tiptap transactions.
      if (!document.querySelector(".lb-tiptap-floating")) return;

      const storage = editor!.storage.liveblocksComments as
        | { pendingComment?: boolean }
        | undefined;
      if (storage?.pendingComment) {
        closePendingCommentChain(editor!);
      }
      // Always safe to call: `selectThread(null)` resolves to clearing the
      // active id list (CommentsExtension.js:242–246). Idempotent when the
      // list is already empty.
      editor!.commands.selectThread(null);
    }

    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, [editor]);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Prevents a `matchesNode` error on Next.js hot reload — known ProseMirror
// quirk. Pulled verbatim from the example repo. Production builds are
// unaffected; this only runs once at module load.
EditorView.prototype.updateState = function updateState(state) {
  // @ts-expect-error — accessing private docView
  if (!this.docView) return;
  // @ts-expect-error — accessing private updateStateInner
  this.updateStateInner(state, this.state.plugins != state.plugins);
};

/**
 * Intercepts an image paste/drop, uploads to Supabase Storage via the
 * `/api/documents/images/upload` route, and inserts the resulting public URL
 * as a Tiptap Image node. Returns `true` if it handled the event so Tiptap
 * skips its own (less useful) default behavior.
 */
function handleImageFiles(
  view: EditorView,
  files: FileList | null | undefined,
  propertyId: string,
  documentId: string,
): boolean {
  if (!files || files.length === 0) return false;
  const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) return false;

  for (const file of images) {
    const placeholderPos = view.state.selection.from;
    void (async () => {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(
          `/api/documents/images/upload?propertyId=${propertyId}&documentId=${documentId}`,
          { method: "POST", body: form },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          console.error("Image upload failed:", body.error ?? res.statusText);
          return;
        }
        const { url } = (await res.json()) as { url: string };
        const node = view.state.schema.nodes.image?.create({ src: url });
        if (!node) return;
        const tr = view.state.tr.insert(placeholderPos, node);
        view.dispatch(tr);
      } catch (e) {
        console.error("Image upload threw:", e);
      }
    })();
  }
  return true;
}
