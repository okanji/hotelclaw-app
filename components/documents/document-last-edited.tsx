"use client";

import { useMemberName } from "@/lib/documents/use-member-name";

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

/**
 * "Edited by Alex · 4m ago" — uses `last_edited_by` from Postgres, not
 * Liveblocks (presence only reflects who is viewing right now).
 */
export function DocumentLastEdited({
  propertyId,
  lastEditedBy,
  updatedAt,
  className,
}: {
  propertyId: string;
  lastEditedBy: string | null | undefined;
  updatedAt: string;
  className?: string;
}) {
  const editorName = useMemberName(propertyId, lastEditedBy);
  const time = formatRelative(updatedAt);

  if (!editorName && !time) return null;

  return (
    <p className={className ?? "text-sm text-muted-foreground tabular-nums"}>
      {editorName ? (
        <>
          Edited by <span className="text-foreground">{editorName}</span>
          <span aria-hidden="true"> · </span>
        </>
      ) : null}
      {time}
    </p>
  );
}
