"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import { DocumentEditor } from "@/components/documents/document-editor";
import { Button } from "@/components/ui/button";
import { useArtifactPanel } from "./artifact-panel-context";

/**
 * The chat's split-screen artifact view — a TRUE split panel, not a modal:
 * no overlay, no backdrop blur, the conversation stays fully readable and
 * interactive beside it (deliberately unlike Sheet, whose hardcoded
 * overlay + sm:max-w-sm made the first cut dim the app and render 384px
 * wide). Hosts the REAL document editor bound to the doc's Liveblocks
 * room, so the AI's transactional writes stream in live and the viewer
 * can co-edit.
 */
export function ArtifactSidePanel({ propertyId }: { propertyId: string }) {
  const { target, close } = useArtifactPanel();

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, close]);

  if (!target) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[min(52vw,900px)] min-w-[420px] flex-col border-l border-border bg-background shadow-xl duration-200 animate-in slide-in-from-right">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {target.title}
        </p>
        {target.kind === "document" ? (
          <Link
            href={`/p/${propertyId}/documents/${target.documentId}`}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Open full page"
          >
            <ExternalLink className="size-4" />
            <span className="sr-only">Open full page</span>
          </Link>
        ) : null}
        <Button size="icon-sm" variant="ghost" onClick={close} aria-label="Close panel">
          <X data-slot="icon" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {target.kind === "document" ? (
          <DocumentEditor
            key={target.documentId}
            propertyId={propertyId}
            documentId={target.documentId}
          />
        ) : null}
      </div>
    </div>
  );
}
