import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READ_SCHEMA, WRITE_SCHEMA } from "@/lib/documents/editor-schema";

/**
 * Drift guard: the server's READ schema must know every node the EDITOR can
 * produce.
 *
 * The incident (2026-08-11): `captureDocumentSnapshot` parsed documents with
 * no schema, so Liveblocks used its StarterKit-only default and silently
 * dropped every other node — tables, callouts, toggles, charts, embeds,
 * attachments, images, task lists — from `body_text`/`body_json` while
 * leaving them intact in Yjs. A census of all 28 stored documents found ZERO
 * non-StarterKit node types in `body_json`. Because `body_text` feeds search
 * and the brain mirror, and `body_json` feeds the AI's read-before-edit, a
 * bot reading such a document saw the table missing and then destroyed it for
 * real on the next mode=replace.
 *
 * lib/documents/editor-schema.ts fixes it by declaring the node set — but it
 * is a hand-maintained SECOND COPY of the editor's extension list, which is
 * exactly the kind of thing that rots. This test is the tripwire: add a node
 * to the editor and forget the schema, and this fails instead of your content
 * quietly disappearing months later.
 *
 * Source-text based, like the agent-runtime drift guards — a cheap tripwire,
 * not a proof.
 */

const repoRoot = join(__dirname, "..", "..", "..");
const editorSrc = readFileSync(
  join(repoRoot, "components", "documents", "document-editor.tsx"),
  "utf8",
);

/**
 * Extension identifiers registered in the editor's `extensions: [...]` array.
 * Deliberately textual: importing document-editor.tsx here would drag React
 * and Liveblocks into a unit test.
 */
function editorExtensionNames(): string[] {
  const block = /extensions:\s*\[([\s\S]*?)\n {4}\],/.exec(editorSrc);
  if (!block) throw new Error("could not locate the editor's extensions array");
  return [...block[1].matchAll(/^\s{6}([A-Z][A-Za-z0-9]*)/gm)].map((m) => m[1]);
}

/**
 * Editor extension identifier → the ProseMirror node/mark names it
 * contributes. Only schema-bearing entries need an entry; plugin-only
 * extensions map to [] and are asserted to contribute nothing.
 */
const CONTRIBUTES: Record<string, string[]> = {
  // Schema-bearing
  StarterKit: ["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "horizontalRule", "hardBreak", "codeBlock", "bold", "italic", "strike", "code"],
  CodeBlockLowlight: ["codeBlock"],
  Link: ["link"],
  Highlight: ["highlight"],
  Image: ["image"],
  Youtube: ["youtube"],
  Table: ["table"],
  TableRow: ["tableRow"],
  TableCell: ["tableCell"],
  TableHeader: ["tableHeader"],
  TaskList: ["taskList"],
  DocumentTaskItem: ["taskItem"],
  Callout: ["callout"],
  ToggleNode: ["toggle"],
  Chart: ["chart"],
  Embed: ["embed"],
  FileAttachment: ["fileAttachment"],
  SpreadsheetEmbed: ["spreadsheetEmbed"],
  SubPage: ["subPage"],
  // Plugin/behaviour only — no schema of their own.
  liveblocks: [],
  TextAlign: [],
  Typography: [],
  Placeholder: [],
  SlashCommand: [],
  BlockReorder: [],
  AiSuggestion: [],
  SpaceForAi: [],
};

describe("editor ↔ server READ schema sync", () => {
  it("every editor extension is accounted for in this guard", () => {
    const unknown = editorExtensionNames().filter((n) => !(n in CONTRIBUTES));
    // A new extension lands here FIRST. Decide what it contributes, add it to
    // CONTRIBUTES, and — if it carries schema — to READ_EXTENSIONS.
    expect(unknown, `unmapped editor extensions: ${unknown.join(", ")}`).toEqual([]);
  });

  it("READ_SCHEMA knows every node the editor can produce", () => {
    const nodes = new Set(Object.keys(READ_SCHEMA.nodes));
    const marks = new Set(Object.keys(READ_SCHEMA.marks));
    const missing: string[] = [];
    for (const ext of editorExtensionNames()) {
      for (const name of CONTRIBUTES[ext] ?? []) {
        if (!nodes.has(name) && !marks.has(name)) missing.push(`${ext} → ${name}`);
      }
    }
    // Anything listed here is a node users can author and the server would
    // silently discard on the next snapshot.
    expect(missing, `READ_SCHEMA is missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("READ_SCHEMA covers the custom nodes specifically", () => {
    // Named explicitly: these are the hand-written stubs, the part most
    // likely to be forgotten when a node definition changes.
    for (const n of [
      "callout",
      "toggle",
      "chart",
      "embed",
      "fileAttachment",
      "spreadsheetEmbed",
      "subPage",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
      "image",
      "taskList",
      "taskItem",
    ]) {
      expect(Object.keys(READ_SCHEMA.nodes), `missing node: ${n}`).toContain(n);
    }
  });

  it("custom-node stubs match the real definitions' content specs", () => {
    // A stub whose content spec disagrees with the editor's would reshape
    // that node's contents on parse — worse than dropping it.
    const nodeSrc = (f: string) =>
      readFileSync(join(repoRoot, "lib", "documents", "nodes", `${f}.ts`), "utf8");
    const specOf = (src: string, key: string) =>
      new RegExp(`${key}:\\s*"([^"]+)"`).exec(src)?.[1] ?? null;

    expect(READ_SCHEMA.nodes.callout.spec.content).toBe(
      specOf(nodeSrc("callout"), "content"),
    );
    expect(READ_SCHEMA.nodes.toggle.spec.content).toBe(
      specOf(nodeSrc("toggle"), "content"),
    );
    // Atoms must stay atoms — a non-atom stub would try to parse children
    // that the real node never has.
    for (const [name, file] of [
      ["chart", "chart"],
      ["embed", "embed"],
      ["fileAttachment", "file-attachment"],
      ["spreadsheetEmbed", "spreadsheet-embed"],
    ] as const) {
      expect(READ_SCHEMA.nodes[name].isAtom, `${name} should be an atom`).toBe(true);
      expect(nodeSrc(file)).toContain("atom: true");
    }
  });

  it("WRITE_SCHEMA stays the narrow AI surface (custom nodes NOT authorable)", () => {
    // The AI may author tables but not callouts/charts/embeds — sanitizeDocHtml
    // strips them, and the write schema must agree rather than quietly accept.
    expect(Object.keys(WRITE_SCHEMA.nodes)).toContain("table");
    for (const n of ["callout", "chart", "embed", "spreadsheetEmbed", "subPage"]) {
      expect(Object.keys(WRITE_SCHEMA.nodes), `AI must not author ${n}`).not.toContain(n);
    }
  });

  it("no snapshot read path parses without a schema", () => {
    // The literal shape of the bug: withProsemirrorDocument({client, roomId})
    // with no third key. Guarding the source text catches a re-introduction
    // in any read path, including the backfill script.
    for (const rel of [
      ["lib", "documents", "snapshot.ts"],
      ["lib", "documents", "write-body.ts"],
      ["scripts", "backfill-document-snapshots.mjs"],
      ["scripts", "seed-demo.mjs"],
    ]) {
      const src = readFileSync(join(repoRoot, ...rel), "utf8");
      const calls = [...src.matchAll(/withProsemirrorDocument[\s\S]{0,120}?\)/g)];
      for (const c of calls) {
        if (!c[0].includes("roomId")) continue;
        expect(c[0], `${rel.join("/")} parses without a schema`).toMatch(/schema/);
      }
    }
  });
});
