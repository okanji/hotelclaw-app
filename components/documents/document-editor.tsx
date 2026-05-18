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

import { useCallback, useEffect, useState } from "react";
import { ClientSideSuspense, useThreads } from "@liveblocks/react/suspense";
import { RoomProvider } from "@liveblocks/react/suspense";
import {
  AnchoredThreads,
  FloatingComposer,
  FloatingThreads,
  FloatingToolbar,
  Toolbar,
  useLiveblocksExtension,
} from "@liveblocks/react-tiptap";
import Highlight from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TaskList } from "@tiptap/extension-list";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import Youtube from "@tiptap/extension-youtube";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorView } from "@tiptap/pm/view";
import { Loader2 } from "lucide-react";
import { roomIdForDocument } from "@/lib/liveblocks/rooms";
import { renameDocument } from "./actions";
import { DocumentAvatars } from "./document-avatars";
import {
  DocumentBreadcrumbs,
  type DocumentCrumb,
} from "./document-breadcrumbs";
import { ComposerCloseContext, DocumentComposer } from "./document-composer";
import { DocumentTaskItem } from "./document-task-item";
import {
  DocumentFloatingThread,
  DocumentThreadIndicator,
  ThreadIndicatorEditorContext,
} from "./document-thread-indicator";
import { SlashCommand } from "./slash-command";
import { SubPage } from "./sub-page-node";

type Props = {
  propertyId: string;
  documentId: string;
  initialTitle: string;
  /** Parent chain (top-level → immediate parent) for the header breadcrumb. */
  ancestors: DocumentCrumb[];
};

const TITLE_SYNC_DEBOUNCE_MS = 600;
const TITLE_MAX_LENGTH = 200;

export function DocumentEditor({
  propertyId,
  documentId,
  initialTitle,
  ancestors,
}: Props) {
  return (
    <RoomProvider
      id={roomIdForDocument(propertyId, documentId)}
      initialPresence={{
        cursor: null,
        selectedTaskId: null,
        draggingTaskId: null,
      }}
    >
      <ClientSideSuspense fallback={<EditorSkeleton />}>
        <EditorInner
          propertyId={propertyId}
          documentId={documentId}
          initialTitle={initialTitle}
          ancestors={ancestors}
        />
      </ClientSideSuspense>
    </RoomProvider>
  );
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
  ancestors,
}: {
  propertyId: string;
  documentId: string;
  initialTitle: string;
  ancestors: DocumentCrumb[];
}) {
  const liveblocks = useLiveblocksExtension({
    // Only applied when the Yjs doc is brand new (first opener wins). Seeds
    // the title heading so the page never opens to a totally blank canvas.
    initialContent: `<h1>${escapeHtml(initialTitle)}</h1><p></p>`,
  });

  const editor = useEditor({
    immediatelyRender: false,
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
    ],
  });

  useTitleSync(editor, documentId);
  const liveTitle = useLiveTitle(editor, initialTitle);
  const closeComposer = useCallback(() => {
    if (!editor) return;
    closePendingCommentChain(editor);
  }, [editor]);
  useFloatingEditorUIDismiss(editor);

  const { threads } = useThreads();

  return (
    // Light mode: match the chat canvas, which is white (Stream paints
    // `--str-chat__background-core-app` → `chrome-0` → `#ffffff`). Dark mode
    // keeps `--background` as before.
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-background">
      <div className="flex shrink-0 items-center border-b border-border/60 bg-muted/20 px-6 py-1.5">
        <DocumentBreadcrumbs
          propertyId={propertyId}
          ancestors={ancestors}
          currentTitle={liveTitle}
        />
      </div>
      <div className="documents-toolbar relative flex shrink-0 items-center justify-center border-b border-border/60 bg-muted/40 px-6 pt-3 pb-2">
        <Toolbar editor={editor} />
        <div className="absolute right-6 top-1/2 -translate-y-1/2">
          <DocumentAvatars />
        </div>
      </div>
      <div className="flex-1 overflow-auto px-6 pb-24">
        <ThreadIndicatorEditorContext.Provider value={editor}>
          <div className="relative mx-auto w-full max-w-3xl pt-16">
            <EditorContent editor={editor} />
            <FloatingToolbar editor={editor} />
            <ComposerCloseContext.Provider value={closeComposer}>
              <FloatingComposer
                editor={editor}
                components={{ Composer: DocumentComposer }}
                style={{ width: 350 }}
              />
            </ComposerCloseContext.Provider>
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
          </div>
        </ThreadIndicatorEditorContext.Provider>
      </div>
    </div>
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
