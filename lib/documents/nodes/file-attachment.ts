"use client";

/**
 * `fileAttachment` — a leaf block node referencing a file uploaded to
 * Supabase Storage (`documents-files` bucket). Renders as a download card
 * with filename, size, and a download button. PDFs additionally get an
 * inline `<embed>` preview inside the card.
 *
 * The actual upload happens in the slash-command picker (file dialog →
 * POST /api/documents/files/upload → insert this node with the URL).
 * This node only stores the resolved URL + display metadata.
 */

import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { FileAttachmentView } from "@/components/documents/nodes/file-attachment-view";

export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: "" as string,
        parseHTML: (el) => el.getAttribute("data-url") ?? "",
        renderHTML: (attrs) => ({ "data-url": String(attrs.url ?? "") }),
      },
      name: {
        default: "" as string,
        parseHTML: (el) => el.getAttribute("data-name") ?? "",
        renderHTML: (attrs) => ({ "data-name": String(attrs.name ?? "") }),
      },
      size: {
        default: 0 as number,
        parseHTML: (el) => Number(el.getAttribute("data-size") ?? 0),
        renderHTML: (attrs) => ({ "data-size": String(attrs.size ?? 0) }),
      },
      mimeType: {
        default: "" as string,
        parseHTML: (el) => el.getAttribute("data-mime") ?? "",
        renderHTML: (attrs) => ({
          "data-mime": String(attrs.mimeType ?? ""),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='file-attachment']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "file-attachment" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView);
  },
});
