"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  flattenFiles,
  useChannelFiles,
  type FileHit,
} from "./use-channel-files";
import { fileLabel, mediaThumbUrl, docAssetUrl } from "./file-utils";

/**
 * Full-channel media gallery — opened from the Files info panel's "See all".
 * Re-uses `useChannelFiles({ mode: "media" })` so we share Stream search +
 * cursor pagination with the panel preview. Infinite-loads on scroll.
 */
export function MediaGallerySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const media = useChannelFiles({ mode: "media", enabled: open });

  const hits = useMemo(
    () => flattenFiles(media.data?.pages),
    [media.data?.pages],
  );
  const q = query.trim().toLowerCase();
  const filtered = q
    ? hits.filter((h) => fileLabel(h.attachment).toLowerCase().includes(q))
    : hits;

  // Sentinel-based infinite scroll. Observe a div at the end; when it enters
  // the viewport, fetch the next page if one exists and we're not already
  // fetching. IntersectionObserver avoids the layout thrash a scroll listener
  // would cause on a grid of N images.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          media.hasNextPage &&
          !media.isFetchingNextPage
        ) {
          void media.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [media]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80svh] max-w-3xl flex-col gap-4 p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Photos and videos</DialogTitle>
        </DialogHeader>
        <div className="relative px-5">
          <SearchIcon
            aria-hidden
            className="absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search photos and videos"
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {media.isLoading && filtered.length === 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square w-full rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {q ? "No matching media." : "No photos or videos yet."}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {filtered.map((hit, i) => (
                <GalleryThumb key={`${hit.message.id}-${i}`} hit={hit} />
              ))}
            </div>
          )}
          <div ref={sentinelRef} className="h-6" aria-hidden />
          {media.isFetchingNextPage ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Loading more…
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GalleryThumb({ hit }: { hit: FileHit }) {
  const url = mediaThumbUrl(hit.attachment);
  const fullUrl = docAssetUrl(hit.attachment) ?? url;
  const label = fileLabel(hit.attachment, "Attachment");
  if (!url) {
    return (
      <div
        aria-label={label}
        className="flex aspect-square w-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground"
      >
        {hit.attachment.type === "video" ? "Video" : "Image"}
      </div>
    );
  }
  return (
    <a
      href={fullUrl ?? url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={cn(
        "block aspect-square w-full overflow-hidden rounded-md shadow-ring",
        "transition hover:ring-foreground/30",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Stream CDN. */}
      <img
        src={url}
        alt={label}
        loading="lazy"
        className="size-full object-cover"
      />
    </a>
  );
}
