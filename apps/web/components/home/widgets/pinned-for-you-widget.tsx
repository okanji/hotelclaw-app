"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { documentsQueryOptions } from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";
import { usePinnedDocs } from "@/lib/documents/use-pinned-docs";
import {
  DividerList,
  ROW_CLASS,
  relativeShort,
  WidgetEmpty,
} from "../editorial-section";

/**
 * The current user's personally pinned documents — their private shortcuts,
 * distinct from the team-shared boards. Backed by `usePinnedDocs` (per-device
 * localStorage), so pinning a doc from the Recent documents row makes it appear
 * here instantly. Resolved against the documents cache for titles + timestamps.
 */
export function PinnedForYouWidget({ propertyId }: { propertyId: string }) {
  const { pinnedIds, togglePin } = usePinnedDocs(propertyId);
  const { data: docs = [] } = useQuery(documentsQueryOptions(propertyId));
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);

  const pinned = useMemo(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    return pinnedIds
      .map((id) => byId.get(id))
      .filter((d): d is NonNullable<typeof d> => !!d);
  }, [pinnedIds, docs]);

  if (pinned.length === 0)
    return (
      <WidgetEmpty>
        Pin a document — hover a row in Recent documents and tap the pin — to
        keep your go-to pages one click away.
      </WidgetEmpty>
    );

  return (
    <DividerList>
      {pinned.map((d) => (
        <li key={d.id} className="group/pin relative">
          <Link
            href={documentHref(propertyId, d.id)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              openDocument(d.id);
            }}
            onMouseEnter={() => prewarm(d.id)}
            className={cn(
              ROW_CLASS,
              "pr-9 transition-colors hover:bg-accent",
            )}
          >
            <Pin
              strokeWidth={1.5}
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {d.title || "Untitled"}
            </span>
            <span className="shrink-0 text-xs text-faint-foreground tabular-nums">
              {relativeShort(d.updated_at)}
            </span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Unpin"
            title="Unpin"
            onClick={() => togglePin(d.id)}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover/pin:opacity-100"
          >
            <PinOff className="size-3.5" />
          </Button>
        </li>
      ))}
    </DividerList>
  );
}
