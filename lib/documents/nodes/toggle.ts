"use client";

/**
 * `toggle` — collapsible details/summary section. The summary is the first
 * paragraph (the visible "title" row when collapsed); everything after is the
 * hidden body, which can contain any nested block content.
 *
 * Open/closed state is stored in a Yjs attr so it syncs across collaborators
 * (Notion does the same — collapse it for everyone, not just yourself). If
 * that proves surprising in practice we can flip it to local-UI-only state
 * with a `local: true` attr config; for v1 the synced behavior is the more
 * familiar default.
 *
 * Editable content: a `summary` paragraph + a `block+` body, modeled with
 * two children. Because the editable region is split across the open
 * area, the React view exposes `<NodeViewContent>` for the body only — the
 * summary lives on the trigger row and is rendered as a separate paragraph
 * child of the node.
 */

import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { ToggleView } from "@/components/documents/nodes/toggle-view";

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  // First child is the summary (a single paragraph); the rest are body
  // blocks. Tiptap/ProseMirror enforces this via the content expression.
  content: "paragraph block*",
  defining: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute("data-open") !== "false",
        renderHTML: (attrs) => ({ "data-open": String(!!attrs.open) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='toggle']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
});
