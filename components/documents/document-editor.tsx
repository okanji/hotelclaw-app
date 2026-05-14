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

import { useEffect } from "react";
import { ClientSideSuspense, useThreads } from "@liveblocks/react/suspense";
import { RoomProvider } from "@liveblocks/react/suspense";
import {
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
import { DocumentTaskItem } from "./document-task-item";

type Props = {
  propertyId: string;
  documentId: string;
  initialTitle: string;
};

const TITLE_SYNC_DEBOUNCE_MS = 600;
const TITLE_MAX_LENGTH = 200;

export function DocumentEditor({ propertyId, documentId, initialTitle }: Props) {
  return (
    <RoomProvider
      id={roomIdForDocument(propertyId, documentId)}
      initialPresence={{ cursor: null, selectedTaskId: null }}
    >
      <ClientSideSuspense fallback={<EditorSkeleton />}>
        <EditorInner
          propertyId={propertyId}
          documentId={documentId}
          initialTitle={initialTitle}
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
}: {
  propertyId: string;
  documentId: string;
  initialTitle: string;
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
    ],
  });

  useTitleSync(editor, documentId);

  const { threads } = useThreads();

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/40">
      <div className="documents-toolbar relative flex shrink-0 items-center justify-center px-6 pt-3 pb-2">
        <Toolbar editor={editor} />
        <div className="absolute right-6 top-1/2 -translate-y-1/2">
          <DocumentAvatars />
        </div>
      </div>
      <div className="flex-1 overflow-auto px-4 pb-16">
        <div className="document-paper mx-auto w-full max-w-3xl">
          <EditorContent editor={editor} />
          <FloatingToolbar editor={editor} />
          <FloatingComposer editor={editor} style={{ width: 350 }} />
          <FloatingThreads threads={threads} editor={editor} />
        </div>
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
