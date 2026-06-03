"use client";

/**
 * `callout` — a Notion-style boxed note. Wraps inline content in a colored
 * frame with an icon (emoji or single-character symbol). The icon and the
 * variant (color tone) live in node attrs; the editable content is regular
 * prosemirror inline content.
 *
 * Not atomic: the body is editable like any paragraph, so typing inside it
 * just works. The drag handle and re-orderable behavior come from
 * `group: "block" + draggable: true` plus the GlobalDragHandle extension's
 * `customNodes` registration in document-editor.tsx.
 */

import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutView } from "@/components/documents/nodes/callout-view";

export type CalloutVariant = "info" | "success" | "warning" | "danger" | "note";

export const CALLOUT_VARIANTS: CalloutVariant[] = [
  "info",
  "success",
  "warning",
  "danger",
  "note",
];

export const Callout = Node.create({
  name: "callout",
  group: "block",
  // Inline content lets users put any inline marks (bold, links, etc.) but
  // not nested blocks. Notion calls this a "callout block"; their version
  // allows nested blocks, but inline is the right v1 — simpler diff,
  // cheaper schema, and 95% of real callouts are one or two sentences.
  content: "inline*",
  defining: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      variant: {
        default: "info" as CalloutVariant,
        parseHTML: (el) =>
          (el.getAttribute("data-variant") as CalloutVariant) || "info",
        renderHTML: (attrs) => ({
          "data-variant": (attrs.variant as CalloutVariant) ?? "info",
        }),
      },
      icon: {
        default: "💡",
        parseHTML: (el) => el.getAttribute("data-icon") || "💡",
        renderHTML: (attrs) => ({ "data-icon": String(attrs.icon ?? "💡") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "aside[data-type='callout']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, { "data-type": "callout" }),
      0, // 0 = put inline content here
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
