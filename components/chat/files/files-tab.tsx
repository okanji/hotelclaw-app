"use client";

import { useMemo, useState } from "react";
import {
  Eye,
  MoreVertical,
  Search as SearchIcon,
  Share2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  flattenFiles,
  useChannelFiles,
  type FileHit,
} from "./use-channel-files";
import {
  docAssetUrl,
  fileLabel,
  formatSharedDate,
  glyphFor,
  mediaThumbUrl,
} from "./file-utils";
import { MediaGallerySheet } from "./media-gallery-sheet";

const MEDIA_GRID_PREVIEW = 6;

/**
 * Full Files view inside the channel info panel. Mirrors Slack desktop:
 *   - search bar
 *   - "Photos and videos" preview grid with a "See all" link (TODO)
 *   - "Documents" list with hover actions (Preview / Share / Menu)
 *
 * Data comes from `useChannelFiles` (Stream `client.search()` + cursor
 * pagination); we paginate the documents list on scroll-to-bottom.
 */
export function FilesTab() {
  const [query, setQuery] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(false);

  const media = useChannelFiles({ mode: "media" });
  const docs = useChannelFiles({ mode: "docs" });

  const mediaHits = useMemo(
    () => flattenFiles(media.data?.pages),
    [media.data?.pages],
  );
  const docHits = useMemo(
    () => flattenFiles(docs.data?.pages),
    [docs.data?.pages],
  );

  const q = query.trim().toLowerCase();
  const filteredDocs = q
    ? docHits.filter((h) => fileLabel(h.attachment).toLowerCase().includes(q))
    : docHits;
  const filteredMedia = q
    ? mediaHits.filter((h) =>
        fileLabel(h.attachment).toLowerCase().includes(q),
      )
    : mediaHits;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files"
          className="pl-8"
        />
      </div>

      {/* Photos & videos */}
      <section>
        <div className="flex items-center justify-between px-1 pb-2">
          <h3 className="text-[13px] text-muted-foreground">Photos and videos</h3>
          {mediaHits.length > MEDIA_GRID_PREVIEW ? (
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              See all
            </button>
          ) : null}
        </div>
        {media.isLoading && filteredMedia.length === 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-md" />
            ))}
          </div>
        ) : filteredMedia.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            No photos or videos yet.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {filteredMedia.slice(0, MEDIA_GRID_PREVIEW).map((hit, i) => (
              <MediaThumb key={`${hit.message.id}-${i}`} hit={hit} />
            ))}
          </div>
        )}
      </section>

      {/* Documents */}
      <section className="flex min-h-0 flex-1 flex-col">
        <h3 className="px-1 pb-1 text-[13px] text-muted-foreground">Documents</h3>
        <ul role="list" className="flex flex-col">
          {docs.isLoading && filteredDocs.length === 0 ? (
            [0, 1, 2, 3].map((i) => (
              <li
                key={i}
                className="flex items-center gap-3 border-b border-border/60 px-1 py-2.5 last:border-0"
              >
                <Skeleton className="size-10 shrink-0 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </li>
            ))
          ) : filteredDocs.length === 0 ? (
            <li className="px-1 py-2 text-xs text-muted-foreground">
              {q ? "No matching documents." : "No documents shared yet."}
            </li>
          ) : (
            filteredDocs.map((hit, i) => (
              <DocRow key={`${hit.message.id}-${i}`} hit={hit} />
            ))
          )}
        </ul>
        {docs.hasNextPage ? (
          <button
            type="button"
            onClick={() => docs.fetchNextPage()}
            disabled={docs.isFetchingNextPage}
            className="mt-2 self-center rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            {docs.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </section>

      <MediaGallerySheet open={galleryOpen} onOpenChange={setGalleryOpen} />
    </div>
  );
}

function MediaThumb({ hit }: { hit: FileHit }) {
  const url = mediaThumbUrl(hit.attachment);
  const label = fileLabel(hit.attachment, "Attachment");
  if (!url) {
    return (
      <div
        aria-label={label}
        className="flex aspect-square w-full items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground"
      >
        {hit.attachment.type === "video" ? "Video" : "Image"}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Stream CDN, tiny thumb.
    <img
      src={url}
      alt={label}
      loading="lazy"
      className="aspect-square w-full rounded-md object-cover ring-1 ring-foreground/10"
    />
  );
}

function DocRow({ hit }: { hit: FileHit }) {
  const a = hit.attachment;
  const name = fileLabel(a);
  const sharedBy = hit.user?.name ?? hit.user?.id ?? "Someone";
  const when = formatSharedDate(hit.message.created_at);
  const url = docAssetUrl(a);
  const glyph = glyphFor(a);

  return (
    <li className="group/file-row relative flex items-center gap-3 border-b border-border/60 px-1 py-2.5 last:border-0 hover:bg-foreground/[0.04]">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-md text-[10px] font-bold"
        style={{ background: glyph.bg, color: glyph.fg }}
      >
        {glyph.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-foreground">
          {name}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          Shared by {sharedBy}
          {when ? ` on ${when}` : ""}
        </span>
      </span>

      {/* Hover-revealed actions, Slack-style. */}
      <span
        className={cn(
          "absolute top-1/2 right-2 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-popover px-1.5 py-0.5 shadow-sm",
          "group-hover/file-row:flex group-focus-within/file-row:flex",
        )}
      >
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] text-foreground hover:bg-foreground/[0.06]"
            aria-label="Preview file"
          >
            <Eye className="size-3.5" />
            Preview
          </a>
        ) : null}
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded text-foreground hover:bg-foreground/[0.06]"
          aria-label="Share file"
          onClick={() => {
            if (url) void navigator.clipboard?.writeText(url);
          }}
        >
          <Share2 className="size-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded text-foreground hover:bg-foreground/[0.06]"
          aria-label="More actions"
        >
          <MoreVertical className="size-3.5" />
        </button>
      </span>
    </li>
  );
}
