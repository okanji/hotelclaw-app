"use client";

import { useMemo, useState } from "react";
import type { Attachment } from "stream-chat";
import { ModalGallery, toGalleryItemDescriptors } from "stream-chat-react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Slack-style wrapper for multi-image messages.
 *
 * Stream v14 folds 2+ media attachments into a synthetic `gallery` attachment
 * whose grid (`GalleryContainer` → `ModalGallery`) never receives the custom
 * `Image` component — so multi-image messages used to render Stream's bare
 * grid with none of the single-image card chrome. This wraps the same
 * `ModalGallery` grid (keeping its lightbox + "+N" overflow behavior) in the
 * card header/frame idiom from `SlackMessageImage`, reusing its CSS classes
 * so the two stay visually in lockstep.
 */
export function SlackGallery({ images }: { images: Attachment[] }) {
  const [expanded, setExpanded] = useState(true);

  const items = useMemo(
    () =>
      images
        .map((a) => toGalleryItemDescriptors(a))
        .filter((i): i is NonNullable<typeof i> => !!i),
    [images],
  );

  if (items.length === 0) return null;

  return (
    <div
      className="str-chat__slack-message-image-card str-chat__slack-gallery-card"
      data-testid="slack-gallery-card"
    >
      <div className="str-chat__slack-message-image-card__header">
        <span className="str-chat__slack-message-image-card__filename">
          {items.length} images
        </span>
        <button
          type="button"
          className={cn(
            "str-chat__slack-message-image-card__collapse-trigger",
            "inline-flex size-[22px] shrink-0 items-center justify-center rounded-md",
            "text-[var(--slack-image-card-muted)] outline-none",
            "hover:bg-[var(--slack-image-card-hover)] focus-visible:shadow-focus",
          )}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse image previews" : "Expand image previews"}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDownIcon
            className={cn(
              "size-[14px] transition-transform duration-150 ease-out",
              !expanded && "-rotate-90",
            )}
            aria-hidden
          />
        </button>
      </div>
      {expanded ? (
        <div className="str-chat__slack-message-image-card__frame">
          <div className="str-chat__slack-message-image-card__frame-inner">
            <ModalGallery items={items} modalClassName="str-chat__image-modal" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
