"use client";

import { useEffect } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ExternalLink } from "lucide-react";

/**
 * Embed node view. Switches on `kind`:
 *
 *  - youtube/vimeo/loom/figma/spotify/codepen → iframe with provider URL
 *  - twitter → blockquote that the twitter-widgets.js script auto-enhances
 *    (loaded once on first mount; idempotent if multiple embeds exist)
 *  - bookmark → og:meta card built from the metadata stored on the node
 *
 * For Twitter we use the standard <blockquote class="twitter-tweet"> markup.
 * If widgets.js isn't loaded yet we fetch it; subsequent embeds reuse it.
 */

let twitterScriptLoaded = false;
function loadTwitterWidgets(): Promise<void> {
  if (twitterScriptLoaded) return Promise.resolve();
  twitterScriptLoaded = true;
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://platform.twitter.com/widgets.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve(); // fail soft — blockquote still renders the text
    document.head.appendChild(s);
  });
}

export function EmbedView({ node }: NodeViewProps) {
  const kind = node.attrs.kind as string;
  const url = node.attrs.url as string;
  const embedUrl = node.attrs.embedUrl as string | null;
  const tweetId = node.attrs.tweetId as string | null;
  const title = node.attrs.title as string | null;
  const description = node.attrs.description as string | null;
  const image = node.attrs.image as string | null;
  const siteName = node.attrs.siteName as string | null;

  useEffect(() => {
    if (kind === "twitter" && tweetId) {
      void loadTwitterWidgets().then(() => {
        const w = window as unknown as {
          twttr?: { widgets?: { load?: () => void } };
        };
        w.twttr?.widgets?.load?.();
      });
    }
  }, [kind, tweetId]);

  return (
    <NodeViewWrapper data-type="embed" className="embed my-2">
      <div contentEditable={false}>
        {kind === "youtube" ||
        kind === "vimeo" ||
        kind === "loom" ||
        kind === "figma" ||
        kind === "spotify" ||
        kind === "codepen" ? (
          <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted/30">
            <iframe
              src={embedUrl ?? url}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
            />
          </div>
        ) : kind === "twitter" && tweetId ? (
          <blockquote className="twitter-tweet">
            <a href={`https://twitter.com/i/web/status/${tweetId}`}>
              View tweet
            </a>
          </blockquote>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-border bg-muted/20 transition hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1 p-3">
              {siteName ? (
                <div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {siteName}
                </div>
              ) : null}
              <div className="line-clamp-2 text-sm font-medium text-foreground">
                {title ?? url}
              </div>
              {description ? (
                <div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                  {description}
                </div>
              ) : null}
              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                <ExternalLink className="size-3" />
                <span className="truncate">{url}</span>
              </div>
            </div>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                className="h-24 w-32 shrink-0 object-cover"
              />
            ) : null}
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}
