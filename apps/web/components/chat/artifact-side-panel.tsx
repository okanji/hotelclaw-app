"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { DocumentEditor } from "@/components/documents/document-editor";
import { SheetEditor } from "@/components/spreadsheet/sheet-editor";
import { Button } from "@/components/ui/button";
import { useArtifactPanel } from "./artifact-panel-context";

const MIN_WIDTH = 380;
const DEFAULT_WIDTH = () =>
  Math.min(Math.round(window.innerWidth * 0.46), 820);
const EXPANDED_WIDTH = () =>
  Math.min(Math.round(window.innerWidth * 0.72), 1200);
const maxWidth = () => Math.round(window.innerWidth * 0.85);

/**
 * The chat's split-screen artifact view — a TRUE LAYOUT split, like
 * Claude's artifact pane: rendered as a flex SIBLING of Stream's <Window>
 * inside `.str-chat__container` (the same mechanism as the thread panel),
 * so the conversation column genuinely compresses to the left. No overlay,
 * no backdrop blur, no fixed positioning. Hosts the REAL editors bound to
 * the record's Liveblocks room/storage, so the AI's writes stream in live
 * and the viewer can co-edit. (Deliberately not a Sheet primitive — its
 * hardcoded overlay + sm:max-w-sm made the first cut dim the app and
 * render 384px wide.)
 */
export function ArtifactSidePanel({ propertyId }: { propertyId: string }) {
  const { target, close } = useArtifactPanel();
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, close]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragStart.current = {
        x: e.clientX,
        width: width ?? DEFAULT_WIDTH(),
      };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [width],
  );
  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current) return;
      // Panel sits at the right edge — dragging the handle LEFT widens it.
      const next = dragStart.current.width + (dragStart.current.x - e.clientX);
      setWidth(Math.min(Math.max(next, MIN_WIDTH), maxWidth()));
    },
    [],
  );
  const onHandlePointerUp = useCallback(() => {
    dragStart.current = null;
    setDragging(false);
  }, []);

  if (!target) return null;

  const fullHref = `/p/${propertyId}/documents/${target.documentId}`;
  const typeLabel = target.kind === "sheet" ? "Spreadsheet" : "Document";
  const currentWidth =
    width ?? (typeof window !== "undefined" ? DEFAULT_WIDTH() : 720);
  const isExpanded =
    typeof window !== "undefined" && currentWidth >= EXPANDED_WIDTH() - 40;

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background"
      style={{ width: currentWidth }}
    >
      {/* Drag-to-resize handle on the panel's left edge. Wider hit area than
          the visible line; pointer capture keeps the drag alive when the
          cursor outruns the handle. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        className={`absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-border ${dragging ? "bg-ring" : ""}`}
      />
      {dragging ? (
        // While dragging, kill iframe/editor pointer events so the sheet or
        // doc below can't swallow the pointermove stream.
        <div className="absolute inset-0 z-[5] cursor-col-resize" />
      ) : null}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{target.title}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span className="text-muted-foreground">{typeLabel}</span>
        </p>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() =>
            setWidth(isExpanded ? DEFAULT_WIDTH() : EXPANDED_WIDTH())
          }
          aria-label={isExpanded ? "Shrink panel" : "Expand panel"}
        >
          {isExpanded ? (
            <Minimize2 data-slot="icon" />
          ) : (
            <Maximize2 data-slot="icon" />
          )}
        </Button>
        <Link
          href={fullHref}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Open full page"
        >
          <ExternalLink className="size-4" />
          <span className="sr-only">Open full page</span>
        </Link>
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
        ) : (
          <SheetEditor
            key={target.documentId}
            propertyId={propertyId}
            documentId={target.documentId}
          />
        )}
      </div>
    </aside>
  );
}
