"use client";

import { useId } from "react";
import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { FileText, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocumentViewerAvatarStack } from "@/components/documents/document-presence-stack";
import { useDocsHomePresence } from "@/components/documents/docs-home-presence";
import { useMemberName } from "@/lib/documents/use-member-name";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";

export type DocumentRowDoc = {
  id: string;
  title: string;
  updated_at: string;
  last_edited_by?: string | null;
};

type DocumentRowProps = {
  propertyId: string;
  doc: DocumentRowDoc;
  /** Shown on the right — defaults to relative `updated_at`. */
  timeLabel?: string;
  /** When true, row is a drag source for pinning to boards. */
  draggable?: boolean;
};

/**
 * Shared document list row for the docs home — used by recents and the full
 * library so both sections share the same visual treatment.
 */
export function DocumentRow({
  propertyId,
  doc,
  timeLabel,
  draggable = false,
}: DocumentRowProps) {
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);
  const viewers = useDocsHomePresence(doc.id);
  const editorName = useMemberName(propertyId, doc.last_edited_by);
  const displayTime = timeLabel ?? formatRelative(doc.updated_at);

  // The same doc renders in multiple lists (recents, "all documents"); dnd-kit
  // keys drag state by id, so a shared `doc:<id>` would make every copy report
  // isDragging at once. A per-instance id keeps them independent — the actual
  // document is resolved from `data.documentId` in the DndContext handlers.
  const instanceId = useId();
  const drag = useDraggable({
    id: `doc:${instanceId}`,
    data: { type: "doc", documentId: doc.id },
    disabled: !draggable,
  });

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(doc.id);
  }

  const rowProps = draggable
    ? {
        ref: drag.setNodeRef,
        style: { transform: CSS.Translate.toString(drag.transform) },
      }
    : {};

  return (
    <li
      {...rowProps}
      className={cn(
        "group/row relative",
        draggable && drag.isDragging && "opacity-40",
      )}
    >
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(doc.id)}
        draggable={false}
        className="flex min-h-[34px] items-center gap-3 rounded-md px-2 py-1.5 transition-colors group-hover/row:bg-accent"
      >
        {draggable ? (
          // Drag handle: only the grip starts a drag, so grabbing the row's
          // title or timestamp navigates instead of dragging. Clicks on the
          // grip are swallowed so it never follows the link.
          <span
            {...drag.attributes}
            {...drag.listeners}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            aria-label="Drag to pin to a board"
            className="-mx-1 flex shrink-0 cursor-grab items-center self-stretch px-1 text-faint-foreground active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="size-4" />
          </span>
        ) : (
          <span className="size-4 shrink-0 self-center" aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {/* 16px is THE row icon everywhere (notion-spec §4) — the two-line
              variant used to bump this to 24px, the only oversized row icon
              in the app. */}
          <FileText
            strokeWidth={1.5}
            className="size-4 shrink-0 text-faint-foreground"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {doc.title || "Untitled"}
            </span>
            {editorName && !timeLabel ? (
              <span className="block truncate text-xs text-faint-foreground">
                Edited by {editorName}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          <DocumentViewerAvatarStack users={viewers} />
          <span className="text-xs text-faint-foreground tabular-nums">
            {displayTime}
          </span>
        </span>
      </Link>
    </li>
  );
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
