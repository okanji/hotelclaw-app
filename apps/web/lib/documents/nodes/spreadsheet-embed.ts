"use client";

/**
 * `spreadsheetEmbed` — iframe embed of a published Google Sheet or
 * Excel Online workbook. Read/edit happens in the provider's UI; we just
 * render the iframe.
 *
 * Stored attrs:
 *   url       — the canonical embed URL (already normalized by detectSpreadsheet)
 *   provider  — "google-sheets" | "excel-online"
 */

import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { SpreadsheetEmbedView } from "@/components/documents/nodes/spreadsheet-embed-view";

export type SpreadsheetProvider = "google-sheets" | "excel-online";

export const SpreadsheetEmbed = Node.create({
  name: "spreadsheetEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: "" as string },
      provider: { default: "google-sheets" as SpreadsheetProvider },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='spreadsheet-embed']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "spreadsheet-embed" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SpreadsheetEmbedView);
  },
});

/** Normalize a user-pasted spreadsheet URL into an embeddable one. Returns
 *  null when the URL isn't a recognised Google Sheets / Excel Online link. */
export function detectSpreadsheet(
  input: string,
): { url: string; provider: SpreadsheetProvider } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  // Google Sheets — accept /edit, /pubhtml, /htmlview. Normalize to
  // /pubhtml?widget=true (the published embed view).
  if (host === "docs.google.com") {
    const m = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) {
      const id = m[1];
      return {
        url: `https://docs.google.com/spreadsheets/d/${id}/pubhtml?widget=true&headers=false`,
        provider: "google-sheets",
      };
    }
  }

  // Excel Online — onedrive.live.com / 1drv.ms / sharepoint.com embed URLs.
  // We accept any of these and trust the user picked the embed URL their
  // provider gave them. Provider-side rewrites are non-trivial (different
  // tenant URLs) so we don't attempt them; users paste the iframe-ready URL.
  if (
    host.endsWith("onedrive.live.com") ||
    host.endsWith("1drv.ms") ||
    host.endsWith("sharepoint.com") ||
    host.endsWith("office.com") ||
    host.endsWith("office.live.com")
  ) {
    return { url: input, provider: "excel-online" };
  }

  return null;
}
