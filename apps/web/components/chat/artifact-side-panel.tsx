"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { DocumentEditor } from "@/components/documents/document-editor";
import { SheetEditor } from "@/components/spreadsheet/sheet-editor";
import { Button } from "@/components/ui/button";
import { useArtifactPanel } from "./artifact-panel-context";

// The panel's own floor, and — more importantly — the conversation's floor.
// The chat stays the PRIMARY pane: it never shrinks below CHAT_FLOOR, and by
// default the panel takes less than half so the AI's replies stay wide.
const MIN_WIDTH = 360;
const CHAT_FLOOR = 560;

// The DEFAULT width is pure CSS, relative to the panel's flex PARENT (the chat
// split area) — NOT window.innerWidth. Measuring against the whole window let
// the panel eat the conversation (a 46vw panel counted the rail + channel
// sidebar, leaving the chat at ~half the *content* area). As CSS `min()`:
// ≤42% of the split, capped at 720px, but never so wide the conversation drops
// below CHAT_FLOOR — floored at MIN_WIDTH. The conversation stays primary with
// zero JS, so no measurement/effect is needed until the user resizes.
const DEFAULT_CSS_WIDTH = `max(${MIN_WIDTH}px, min(42%, calc(100% - ${CHAT_FLOOR}px), 720px))`;

// Drag/expand produce explicit px widths; clamp them the same way (relative to
// the measured chat container, keeping the conversation ≥ CHAT_FLOOR).
function clampWidth(desired: number, containerW: number): number {
  const maxByFloor = Math.max(MIN_WIDTH, containerW - CHAT_FLOOR);
  return Math.max(MIN_WIDTH, Math.min(desired, maxByFloor));
}
const expandedWidth = (c: number) => clampWidth(Math.min(Math.round(c * 0.64), 1040), c);

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
  const asideRef = useRef<HTMLElement>(null);
  // px override; null = the CSS default (DEFAULT_CSS_WIDTH), which is relative
  // to the parent so the split needs no measurement and the conversation stays
  // primary. A number is only stored once the user drags or expands.
  const [width, setWidth] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  // Chat split area width — read from the ref only inside handlers (never
  // during render), so drag/expand clamps stay relative to the chat pane.
  const containerW = useCallback(
    () =>
      asideRef.current?.parentElement?.clientWidth ??
      (typeof window !== "undefined" ? window.innerWidth : 1200),
    [],
  );

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
      // Start from the CURRENT rendered width (CSS default or px) so the first
      // drag pixel doesn't jump.
      dragStart.current = {
        x: e.clientX,
        width: asideRef.current?.clientWidth ?? MIN_WIDTH,
      };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );
  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current) return;
      // Panel sits at the right edge — dragging the handle LEFT widens it.
      const next = dragStart.current.width + (dragStart.current.x - e.clientX);
      setWidth(clampWidth(next, containerW()));
    },
    [containerW],
  );
  const onHandlePointerUp = useCallback(() => {
    dragStart.current = null;
    setDragging(false);
  }, []);

  const toggleExpand = useCallback(() => {
    if (expanded) {
      setExpanded(false);
      setWidth(null); // back to the CSS default
    } else {
      setExpanded(true);
      setWidth(expandedWidth(containerW()));
    }
  }, [expanded, containerW]);

  if (!target) return null;

  const fullHref = `/p/${propertyId}/documents/${target.documentId}`;
  const typeLabel = target.kind === "sheet" ? "Spreadsheet" : "Document";

  return (
    <aside
      ref={asideRef}
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background"
      style={{ width: width != null ? width : DEFAULT_CSS_WIDTH }}
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
          onClick={toggleExpand}
          aria-label={expanded ? "Shrink panel" : "Expand panel"}
        >
          {expanded ? (
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
