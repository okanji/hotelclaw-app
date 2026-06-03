"use client";

/**
 * `embed` — generic URL embed block. The node view picks a rendering
 * strategy from the URL via `detectEmbed` (lib/documents/url-embeds.ts):
 * known providers render an iframe; unknown hosts render a bookmark card
 * built from og:meta fetched on insert.
 *
 * Stored attrs:
 *   url             — the canonical URL the user pasted
 *   kind            — detected kind, persisted so we don't re-detect on
 *                     every render
 *   embedUrl?       — provider iframe URL (when kind ≠ bookmark/twitter)
 *   tweetId?        — when kind === "twitter"
 *   title/description/image/siteName? — bookmark metadata, optional
 */

import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { EmbedView } from "@/components/documents/nodes/embed-view";

export type EmbedKind =
  | "youtube"
  | "vimeo"
  | "loom"
  | "figma"
  | "twitter"
  | "spotify"
  | "codepen"
  | "bookmark";

export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: "" as string },
      kind: { default: "bookmark" as EmbedKind },
      embedUrl: { default: null as string | null },
      tweetId: { default: null as string | null },
      title: { default: null as string | null },
      description: { default: null as string | null },
      image: { default: null as string | null },
      siteName: { default: null as string | null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='embed']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "embed" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});
