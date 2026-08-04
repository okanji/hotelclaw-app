"use client";

/**
 * Version history for a document, backed by Liveblocks' native Yjs version
 * snapshots. Liveblocks stores versions automatically as the document changes;
 * we also snapshot one each time an AI edit is accepted (see
 * `createTextVersion` in document-editor.tsx).
 *
 * A right-side Sheet lists every version (`useHistoryVersions` +
 * `HistoryVersionSummary`) and previews the selected one
 * (`HistoryVersionPreview`), which renders that snapshot's content and offers
 * a Restore action that rolls the live document back to it.
 */

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { History, Loader2 } from "lucide-react";
import { useHistoryVersions } from "@liveblocks/react";
import {
  HistoryVersionSummary,
  HistoryVersionSummaryList,
} from "@liveblocks/react-ui";
import { HistoryVersionPreview } from "@liveblocks/react-tiptap";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function DocumentHistory({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:shadow-focus"
            title="Version history"
          >
            <History className="size-3.5" />
            History
          </button>
        )}
      />
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>Version history</SheetTitle>
        </SheetHeader>
        {open && editor ? (
          <HistoryContents editor={editor} onRestored={() => setOpen(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function HistoryContents({
  editor,
  onRestored,
}: {
  editor: Editor;
  onRestored: () => void;
}) {
  const { versions, isLoading, error } = useHistoryVersions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading versions…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Couldn’t load version history.
      </div>
    );
  }
  if (!versions || versions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-foreground">No versions yet</p>
        <p className="text-sm text-muted-foreground">
          Versions are saved automatically as the document changes, and each
          time you accept an AI suggestion.
        </p>
      </div>
    );
  }

  // Default to the most recent version (Liveblocks returns newest first).
  const selected =
    versions.find((v) => v.id === selectedId) ?? versions[0];

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border p-2">
        <HistoryVersionSummaryList>
          {versions.map((version) => (
            <HistoryVersionSummary
              key={version.id}
              version={version}
              selected={version.id === selected.id}
              onClick={() => setSelectedId(version.id)}
            />
          ))}
        </HistoryVersionSummaryList>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <HistoryVersionPreview
          key={selected.id}
          version={selected}
          editor={editor}
          onVersionRestore={onRestored}
        />
      </div>
    </div>
  );
}
