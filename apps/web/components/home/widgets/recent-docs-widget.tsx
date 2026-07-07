"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileText, Pin } from "lucide-react";
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

const LIMIT = 6;

/** The property's most recently edited documents, each pinnable to the user's
 *  personal "Pinned for you" shortcuts. */
export function RecentDocsWidget({ propertyId }: { propertyId: string }) {
  const { data: docs = [], isPending } = useQuery(
    documentsQueryOptions(propertyId),
  );
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);
  const { isPinned, togglePin } = usePinnedDocs(propertyId);
  const recent = useMemo(() => docs.slice(0, LIMIT), [docs]);

  if (isPending) return <WidgetEmpty>Loading documents…</WidgetEmpty>;
  if (recent.length === 0) return <WidgetEmpty>No documents yet.</WidgetEmpty>;

  return (
    <DividerList>
      {recent.map((d) => {
        const pinned = isPinned(d.id);
        return (
          <li key={d.id} className="group/doc relative">
            <Link
              href={documentHref(propertyId, d.id)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                  return;
                e.preventDefault();
                openDocument(d.id);
              }}
              onMouseEnter={() => prewarm(d.id)}
              className={cn(
                ROW_CLASS,
                "rounded-md pr-9 transition-colors hover:bg-muted",
              )}
            >
              <FileText
                strokeWidth={1.5}
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-sm tracking-tight text-foreground">
                {d.title || "Untitled"}
              </span>
              <span className="shrink-0 text-xs tracking-tight text-muted-foreground tabular-nums">
                {relativeShort(d.updated_at)}
              </span>
            </Link>
            <button
              type="button"
              aria-label={pinned ? "Unpin" : "Pin for you"}
              title={pinned ? "Unpin" : "Pin for you"}
              onClick={() => togglePin(d.id)}
              className={cn(
                "absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md transition-opacity hover:bg-background",
                pinned
                  ? "text-foreground opacity-100"
                  : "text-muted-foreground opacity-0 hover:text-foreground group-hover/doc:opacity-100",
              )}
            >
              <Pin
                className={cn("size-3.5", pinned && "fill-current")}
              />
            </button>
          </li>
        );
      })}
    </DividerList>
  );
}
