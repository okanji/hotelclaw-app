/**
 * The ONE ProseMirror schema the server uses to read and write document
 * bodies. Everything the editor can produce must be represented here.
 *
 * WHY THIS EXISTS (the silent-content-loss bug, 2026-08-11):
 * `captureDocumentSnapshot` called `withProsemirrorDocument({client, roomId})`
 * with NO schema, so Liveblocks parsed every document with its StarterKit-only
 * default. Any node outside StarterKit — tables, callouts, toggles, charts,
 * embeds, file attachments, images, task lists, sub-pages — was silently
 * dropped from the derived `body_text` / `body_json` while remaining perfectly
 * intact in the Yjs room. A census of all 28 stored documents found ZERO
 * non-StarterKit nodes in `body_json`: exactly the fingerprint of this bug.
 *
 * The damage was not merely cosmetic:
 *   • `body_text` feeds FTS search and the brain mirror, so that content was
 *     unsearchable and invisible to every bot.
 *   • `readDocumentBodyHtml` builds from `body_json`, so the AI's
 *     read-before-edit saw a document with the table missing, then wrote back
 *     "everything unchanged" with mode=replace — destroying it for real.
 *
 * MAINTENANCE CONTRACT: when you add a node to the editor's extension list in
 * components/documents/document-editor.tsx, add it here too. The custom nodes
 * below are SCHEMA-ONLY STUBS — same name/group/content/atom/attrs as the real
 * ones, minus `addNodeView`, because the real definitions import React views
 * and cannot be loaded on the server. Only the schema shape has to match; the
 * rendering does not.
 */
import { Node } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { Youtube } from "@tiptap/extension-youtube";
import { TaskList, TaskItem } from "@tiptap/extension-list";

// ── Schema-only stubs for the custom nodes ──────────────────────────────
// Mirror lib/documents/nodes/*.ts and components/documents/sub-page-node.tsx.

const CalloutSchema = Node.create({
  name: "callout",
  group: "block",
  content: "inline*",
  defining: true,
  draggable: true,
  selectable: true,
  addAttributes: () => ({ variant: { default: "info" }, icon: { default: "💡" } }),
  parseHTML: () => [{ tag: "aside[data-type='callout']" }],
  renderHTML: () => ["aside", { "data-type": "callout" }, 0],
});

const ToggleSchema = Node.create({
  name: "toggle",
  group: "block",
  content: "paragraph block*",
  defining: true,
  draggable: true,
  selectable: true,
  addAttributes: () => ({ open: { default: true } }),
  parseHTML: () => [{ tag: "div[data-type='toggle']" }],
  renderHTML: () => ["div", { "data-type": "toggle" }, 0],
});

const ChartSchema = Node.create({
  name: "chart",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({
    type: { default: "bar" },
    title: { default: "" },
    data: { default: null },
  }),
  parseHTML: () => [{ tag: "div[data-type='chart']" }],
  renderHTML: () => ["div", { "data-type": "chart" }],
});

const EmbedSchema = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({
    url: { default: "" },
    kind: { default: "bookmark" },
    embedUrl: { default: null },
    tweetId: { default: null },
    title: { default: null },
    description: { default: null },
    image: { default: null },
    siteName: { default: null },
  }),
  parseHTML: () => [{ tag: "div[data-type='embed']" }],
  renderHTML: () => ["div", { "data-type": "embed" }],
});

const FileAttachmentSchema = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({
    url: { default: "" },
    name: { default: "" },
    size: { default: 0 },
    mimeType: { default: "" },
  }),
  parseHTML: () => [{ tag: "div[data-type='file-attachment']" }],
  renderHTML: () => ["div", { "data-type": "file-attachment" }],
});

const SpreadsheetEmbedSchema = Node.create({
  name: "spreadsheetEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({ url: { default: "" }, provider: { default: "google-sheets" } }),
  parseHTML: () => [{ tag: "div[data-type='spreadsheet-embed']" }],
  renderHTML: () => ["div", { "data-type": "spreadsheet-embed" }],
});

const SubPageSchema = Node.create({
  name: "subPage",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({ documentId: { default: null } }),
  parseHTML: () => [{ tag: "div[data-sub-page]" }],
  renderHTML: () => ["div", { "data-sub-page": "" }],
});

/**
 * READ set — everything the editor can produce. Used to parse the Yjs room
 * into body_text / body_json, so it must be a superset of anything a human or
 * a bot can author. StarterKit keeps its own `codeBlock` here (the editor
 * swaps in CodeBlockLowlight, but that is the same `codeBlock` node name and
 * schema shape) and its own `link` mark.
 */
export const READ_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  Link,
  Highlight,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Image,
  Youtube,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem,
  CalloutSchema,
  ToggleSchema,
  ChartSchema,
  EmbedSchema,
  FileAttachmentSchema,
  SpreadsheetEmbedSchema,
  SubPageSchema,
];

/**
 * WRITE set — the narrower surface the AI may author (matches doc-bot's
 * ALLOWED_TAGS). Deliberately NOT the read set: custom nodes stay
 * human-authored, and a model emitting one should have it stripped rather
 * than silently accepted.
 */
export const WRITE_EXTENSIONS = [StarterKit, Table, TableRow, TableCell, TableHeader];

/** Schema for parsing stored documents. Pass to `withProsemirrorDocument`. */
export const READ_SCHEMA = getSchema(READ_EXTENSIONS);

/** Schema for AI-authored writes. */
export const WRITE_SCHEMA = getSchema(WRITE_EXTENSIONS);
