"use client";

/**
 * Floating review bar for a pending inline AI suggestion. Appears at the top of
 * the editor whenever the document holds un-reviewed AI changes (red deletions
 * / green additions) and lets the user Accept or Reject them all at once.
 *
 * "Pending" is derived from the document marks (see `hasPendingAiSuggestion`),
 * recomputed on every editor transaction, so the bar shows/hides automatically
 * as suggestions are applied or resolved.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Check, Sparkles, X } from "lucide-react";
import { useRoom } from "@liveblocks/react";
import { hasPendingAiSuggestion } from "@/lib/documents/ai-suggestion";

export function AiReviewBar({
  editor,
}: {
  editor: Editor | null;
}) {
  const [pending, setPending] = useState(false);
  // Non-suspense useRoom (`@liveblocks/react`, not `/suspense`). Calling
  // the suspense version in the parent EditorInner alongside
  // useLiveblocksExtension triggers "Rendered more hooks than during the
  // previous render" across the suspend/resume cycle. Here the room is
  // already connected by the time AiReviewBar mounts.
  const room = useRoom();

  useEffect(() => {
    if (!editor) return;
    const sync = () => setPending(hasPendingAiSuggestion(editor));
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  if (!editor || !pending) return null;

  // Snapshot a Liveblocks version each time an AI edit is accepted so the
  // change becomes a restorable point in version history. `createTextVersion`
  // exists at runtime but isn't on the public typed Room surface — cast
  // through to reach it.
  function snapshotVersion() {
    const createVersion = (
      room as unknown as { createTextVersion?: () => Promise<void> }
    ).createTextVersion;
    if (!createVersion) return;
    void createVersion.call(room).catch((err: unknown) => {
      console.warn("[documents] createTextVersion failed", err);
    });
  }

  return (
    <div className="pointer-events-none sticky top-3 z-40 -mb-2 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-popover/95 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Sparkles className="size-3.5 text-violet-500" />
          AI suggested changes
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().rejectAiEdit().run();
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
          >
            <X className="size-3.5" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().acceptAiEdit().run();
              snapshotVersion();
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-emerald-500"
          >
            <Check className="size-3.5" />
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
