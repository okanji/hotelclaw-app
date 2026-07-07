"use client";

import { useState, type ComponentProps } from "react";
import {
  ChevronDownIcon,
  CloudDownloadIcon,
  InfoIcon,
  MoreVerticalIcon,
  Share2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { ImageComponent as StreamMessageImage } from "stream-chat-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type GalleryImageProps = ComponentProps<typeof StreamMessageImage>;

function safeHttpUrl(url: string | undefined | null): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* ignore */
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Uploads land in Stream's CDN as `<uuid>.<original-name>` (e.g.
// `3fc6a0fb-21c7-4e34-b2a1-116215afeaac.IMG_5119.HEIC`). Strip the UUID so the
// filename row shows the human-readable original (matches Slack).
const UPLOAD_UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i;
function stripUploadUuid(name: string): string {
  return name.replace(UPLOAD_UUID_PREFIX, "");
}

function displayNameForImage(item: GalleryImageProps): string {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (title) return stripUploadUuid(title);
  const href = item.imageUrl?.trim();
  if (href) {
    try {
      const last = new URL(href).pathname.split("/").filter(Boolean).pop();
      if (last) return stripUploadUuid(decodeURIComponent(last));
    } catch {
      /* ignore */
    }
  }
  const alt = typeof item.alt === "string" ? item.alt.trim() : "";
  if (alt) return alt;
  return "Image";
}

function downloadImage(openUrl: string, filename: string) {
  try {
    const a = document.createElement("a");
    a.href = openUrl;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.referrerPolicy = "no-referrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    window.open(openUrl, "_blank", "noopener,noreferrer");
  }
}

async function shareOrCopyLink(openUrl: string) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ url: openUrl });
      return;
    } catch {
      /* user cancelled or share failed — fall through */
    }
  }
  try {
    await navigator.clipboard.writeText(openUrl);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Could not copy link");
  }
}

/**
 * Slack-style image block: filename row + collapse chevron, framed thumbnail with
 * floating toolbar (download / share / info / more) on hover/focus plus optional +ALT badge.
 */
export function SlackMessageImage(props: GalleryImageProps) {
  const [expanded, setExpanded] = useState(true);

  const label = displayNameForImage(props);
  const openUrl = safeHttpUrl(props.imageUrl);
  const altRaw = typeof props.alt === "string" ? props.alt.trim() : "";
  // Stream sometimes populates `alt` with the image URL itself when no real
  // alt text was set on upload. That's not human-meaningful text — drop it so
  // the Details popover and "+ ALT" badge only surface real descriptions.
  const altLabel =
    altRaw && !isHttpUrl(altRaw) ? altRaw.replace(/\s+/g, " ").trim() : "";

  return (
    <div className="str-chat__slack-message-image-card" data-testid="slack-message-image-card">
      <div className="str-chat__slack-message-image-card__header">
        <span className="str-chat__slack-message-image-card__filename" title={label}>
          {label}
        </span>
        <button
          type="button"
          className={cn(
            "str-chat__slack-message-image-card__collapse-trigger",
            "inline-flex size-[22px] shrink-0 items-center justify-center rounded",
            "text-[var(--slack-image-card-muted)] outline-none",
            "hover:bg-[var(--slack-image-card-hover)] focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse image preview" : "Expand image preview"}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDownIcon
            className={cn("size-[14px] transition-transform duration-150 ease-out", !expanded && "-rotate-90")}
            aria-hidden
          />
        </button>
      </div>
      {expanded ? (
        <div className="str-chat__slack-message-image-card__frame">
          <div className="str-chat__slack-message-image-card__frame-inner">
            <div
              className="str-chat__slack-message-image-card__toolbar"
              role="toolbar"
              aria-label="Image actions"
            >
              <button
                type="button"
                className={cn(
                  "str-chat__slack-message-image-card__toolbar-btn",
                  !openUrl && "cursor-not-allowed opacity-45",
                )}
                title="Download"
                aria-label="Download"
                disabled={!openUrl}
                onClick={() => openUrl && downloadImage(openUrl, label)}
              >
                <CloudDownloadIcon strokeWidth={1.75} className="size-[17px]" aria-hidden />
              </button>

              <button
                type="button"
                className={cn(
                  "str-chat__slack-message-image-card__toolbar-btn",
                  !openUrl && "cursor-not-allowed opacity-45",
                )}
                title="Share"
                aria-label="Share"
                disabled={!openUrl}
                onClick={() => void (openUrl && shareOrCopyLink(openUrl))}
              >
                <Share2Icon strokeWidth={1.75} className="size-[16px]" aria-hidden />
              </button>

              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="str-chat__slack-message-image-card__toolbar-btn"
                      title="Details"
                      aria-label="File details"
                    >
                      <InfoIcon strokeWidth={1.75} className="size-[17px]" aria-hidden />
                    </button>
                  }
                />
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={8}
                  className="z-[210] max-w-[min(18rem,calc(100vw-24px))] gap-3 p-3 text-sm leading-snug shadow-lg"
                >
                  <dl className="grid gap-2">
                    <div>
                      <dt className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                        Name
                      </dt>
                      <dd className="mt-0.5 break-all font-medium break-words">{label}</dd>
                    </div>
                    {altLabel ? (
                      <div>
                        <dt className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                          Alt text
                        </dt>
                        <dd className="mt-0.5 break-words text-foreground">{altLabel}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                        Link
                      </dt>
                      <dd className="mt-0.5 break-all break-words">
                        {openUrl ? (
                          <a
                            href={openUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {openUrl}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">Not available</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </PopoverContent>
              </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger
                  type="button"
                  className="str-chat__slack-message-image-card__toolbar-btn"
                  title="More actions"
                  aria-label="More actions"
                >
                  <MoreVerticalIcon strokeWidth={1.75} className="size-[16px]" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className="z-[220] min-w-[11rem]">
                  {openUrl ? (
                    <>
                      <DropdownMenuItem
                        onClick={() => {
                          window.open(openUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        Open original
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          void (async () => {
                            try {
                              await navigator.clipboard.writeText(openUrl);
                              toast.success("Link copied");
                            } catch {
                              toast.error("Could not copy");
                            }
                          })();
                        }}
                      >
                        Copy link
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem disabled>No link available</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {altLabel ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="str-chat__slack-message-image-card__alt-badge"
                      aria-label="View alt text"
                    >
                      + ALT
                    </button>
                  }
                />
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="z-[210] max-w-[min(20rem,calc(100vw-24px))] p-3 text-sm leading-snug"
                >
                  <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                    Alt text
                  </p>
                  <p className="mt-1 break-words text-foreground">{altLabel}</p>
                </PopoverContent>
              </Popover>
            ) : null}

            <StreamMessageImage {...props} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
