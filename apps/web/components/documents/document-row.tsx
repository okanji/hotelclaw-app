"use client";

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

  const drag = useDraggable({
    id: `doc:${doc.id}`,
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
        ...drag.attributes,
        ...drag.listeners,
      }
    : {};

  return (
    <li
      {...rowProps}
      className={cn(
        "group/row relative",
        draggable && "cursor-grab active:cursor-grabbing",
        draggable && drag.isDragging && "opacity-40",
      )}
    >
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(doc.id)}
        draggable={false}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 group-hover/row:bg-muted/50"
      >
        {draggable ? (
          <GripVertical
            aria-hidden
            className="size-4 shrink-0 self-center text-muted-foreground/30 group-hover/row:text-muted-foreground/60"
          />
        ) : (
          <span className="size-4 shrink-0 self-center" aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <FileText
            strokeWidth={1.5}
            className={cn(
              "shrink-0 text-muted-foreground",
              editorName && !timeLabel ? "size-6" : "size-4",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {doc.title || "Untitled"}
            </span>
            {editorName && !timeLabel ? (
              <span className="block truncate text-sm text-muted-foreground">
                Edited by {editorName}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          <DocumentViewerAvatarStack users={viewers} />
          <span className="text-sm text-muted-foreground tabular-nums">
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
