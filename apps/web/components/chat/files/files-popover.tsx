"use client";

import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

/**
 * Slack-style hover preview for the channel Files tab. Shows the most recent
 * 3 photos/videos in a strip and the next ~6 documents as a list.
 *
 * Click semantics: when the trigger button is clicked we suppress the
 * popover toggle and call `onClick` (typically opens the full Files view).
 * Hover state is driven by base-ui's built-in `openOnHover` on
 * `PopoverTrigger`, so we only need controlled `open` state to intercept
 * the click case.
 */
export function FilesPopover({
  children,
  onClick,
}: {
  /** The trigger button — rendered via base-ui's `render` slot. */
  children: React.ReactElement;
  /** Called when the user clicks the trigger; popover is force-closed first. */
  onClick?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Only fetch once the user actually hovers so we don't spam Stream's search
  // API on every channel render.
  const media = useChannelFiles({ mode: "media", enabled: open });
  const docs = useChannelFiles({ mode: "docs", enabled: open });

  const mediaHits = useMemo(
    () => flattenFiles(media.data?.pages).slice(0, 3),
    [media.data?.pages],
  );
  const docHits = useMemo(
    () => flattenFiles(docs.data?.pages).slice(0, 6),
    [docs.data?.pages],
  );
  const empty =
    !media.isLoading &&
    !docs.isLoading &&
    mediaHits.length === 0 &&
    docHits.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={children}
        openOnHover
        delay={120}
        closeDelay={140}
        onClick={() => {
          // base-ui's click handler will fire `setOpen(true)` first; override
          // it after so the popover doesn't pop while we navigate to the full
          // panel.
          setOpen(false);
          onClick?.();
        }}
      />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-[420px] max-w-[92vw] gap-0 p-3"
      >
        {empty ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            No files shared in this channel yet.
          </p>
        ) : null}

        {media.isLoading || mediaHits.length > 0 ? (
          <section>
            <h3 className="px-1 pb-2 text-sm text-muted-foreground">
              Photos and videos
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {media.isLoading && mediaHits.length === 0
                ? [0, 1, 2].map((i) => (
                    <Skeleton key={i} className="aspect-square w-full rounded-md" />
                  ))
                : mediaHits.map((hit, i) => (
                    <MediaThumb key={`${hit.message.id}-${i}`} hit={hit} />
                  ))}
            </div>
          </section>
        ) : null}

        {docs.isLoading || docHits.length > 0 ? (
          <section className="mt-3">
            <h3 className="px-1 pb-1 text-sm text-muted-foreground">
              Documents
            </h3>
            <ul role="list" className="flex flex-col">
              {docs.isLoading && docHits.length === 0
                ? [0, 1, 2].map((i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 border-b border-border px-1 py-2 last:border-0"
                    >
                      <Skeleton className="size-10 shrink-0 rounded-md" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-3.5 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </li>
                  ))
                : docHits.map((hit, i) => (
                    <DocRow key={`${hit.message.id}-${i}`} hit={hit} />
                  ))}
            </ul>
          </section>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function MediaThumb({ hit }: { hit: FileHit }) {
  const url = mediaThumbUrl(hit.attachment);
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
    // eslint-disable-next-line @next/next/no-img-element -- Stream-hosted CDN; size is tiny.
    <img
      src={url}
      alt={label}
      className="aspect-square w-full rounded-md object-cover shadow-ring"
      loading="lazy"
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

  const inner = (
    <span
      className={cn(
        "flex w-full items-center gap-3 px-1 py-2",
        url ? "transition-colors hover:bg-accent" : "",
      )}
    >
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-md text-xs font-semibold"
        style={{ background: glyph.bg, color: glyph.fg }}
      >
        {glyph.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          Shared by {sharedBy}
          {when ? ` on ${when}` : ""}
        </span>
      </span>
    </span>
  );

  return (
    <li className="border-b border-border last:border-0">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md focus-visible:outline-none focus-visible:shadow-focus"
        >
          {inner}
        </a>
      ) : (
        inner
      )}
    </li>
  );
}
