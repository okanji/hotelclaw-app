/**
 * Inline AI suggestion layer for the document editor.
 *
 * When the AI proposes an edit, we don't apply it silently — we render it as a
 * reviewable diff INSIDE the document: removed blocks get a red strikethrough
 * (`aiDelete` mark), added blocks get a green highlight (`aiInsert` mark). The
 * user then Accepts (drop the red, keep the green) or Rejects (drop the green,
 * restore the red) via the floating review bar.
 *
 * Design notes:
 *  - Diff granularity is the top-level BLOCK (paragraph / heading / list item).
 *    We diff the plain text of each body block against the proposed body's
 *    blocks (`diffArrays`), so only changed blocks light up — unchanged blocks
 *    keep their exact formatting. This matches a git-style line diff and is far
 *    more robust than trying to map a character diff back across rich nodes.
 *  - The document's first top-level node is the TITLE (Notion-style, see
 *    document-editor.tsx) and is never part of a suggestion.
 *  - "Pending" state is DERIVED from whether any aiInsert/aiDelete marks exist
 *    in the doc (see `hasPendingAiSuggestion`), so it reacts to every editor
 *    transaction without separate state to keep in sync.
 */

import { Extension, Mark, generateJSON, type Editor } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { diffArrays } from "diff";

/** Minimal ProseMirror-JSON shape we manipulate when marking blocks. */
type JsonNode = {
  type?: string;
  text?: string;
  marks?: { type: string }[];
  content?: JsonNode[];
};

const INSERT = "aiInsert";
const DELETE = "aiDelete";

/** Green "added by AI" mark. */
export const AiInsertMark = Mark.create({
  name: INSERT,
  inclusive: false,
  parseHTML() {
    return [{ tag: "span[data-ai-insert]" }];
  },
  renderHTML() {
    return ["span", { "data-ai-insert": "true", class: "ai-insert" }, 0];
  },
});

/** Red "removed by AI" mark (rendered struck-through). */
export const AiDeleteMark = Mark.create({
  name: DELETE,
  inclusive: false,
  parseHTML() {
    return [{ tag: "span[data-ai-delete]" }];
  },
  renderHTML() {
    return ["span", { "data-ai-delete": "true", class: "ai-delete" }, 0];
  },
});

/** Concatenate the text of a JSON node tree. */
function textOf(node: JsonNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.content) return node.content.map(textOf).join("");
  return "";
}

/** Return a copy of `node` with `markName` added to every text descendant. */
function addMark(node: JsonNode, markName: string): JsonNode {
  if (node.type === "text") {
    const marks = node.marks ? [...node.marks] : [];
    if (!marks.some((m) => m.type === markName)) marks.push({ type: markName });
    return { ...node, marks };
  }
  if (node.content) {
    return { ...node, content: node.content.map((c) => addMark(c, markName)) };
  }
  return node;
}

/** True when the document currently holds an un-reviewed AI suggestion. */
export function hasPendingAiSuggestion(editor: Editor | null): boolean {
  if (!editor || editor.isDestroyed) return false;
  if (!editor.schema.marks[INSERT] && !editor.schema.marks[DELETE]) return false;
  let found = false;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (
      node.isText &&
      node.marks.some((m) => m.type.name === INSERT || m.type.name === DELETE)
    ) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

/** Collect [from,to] of every top-level node containing `markName` text. */
function topLevelNodesWithMark(
  editor: Editor,
  markName: string,
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  editor.state.doc.forEach((node, offset) => {
    let has = false;
    node.descendants((child) => {
      if (
        child.isText &&
        child.marks.some((m) => m.type.name === markName)
      ) {
        has = true;
      }
    });
    if (has) out.push({ from: offset, to: offset + node.nodeSize });
  });
  return out;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    aiSuggestion: {
      /** Diff the proposed body HTML against the live body and show it inline. */
      previewAiReplace: (bodyHtml: string) => ReturnType;
      /** Insert new content as a pending (green) addition at cursor or end. */
      previewAiInsert: (html: string, atEnd: boolean) => ReturnType;
      /** Keep additions, drop deletions — commit the suggestion. */
      acceptAiEdit: () => ReturnType;
      /** Drop additions, restore deletions — discard the suggestion. */
      rejectAiEdit: () => ReturnType;
    };
  }
}

export const AiSuggestion = Extension.create({
  name: "aiSuggestion",

  addExtensions() {
    return [AiInsertMark, AiDeleteMark];
  },

  addCommands() {
    return {
      previewAiReplace:
        (bodyHtml: string) =>
        ({ editor, state, dispatch }) => {
          const { schema, doc } = state;
          if (!schema.marks[INSERT] || !schema.marks[DELETE]) return false;

          // Body = everything after the title (first top-level node).
          const titleSize = doc.firstChild ? doc.firstChild.nodeSize : 0;
          const bodyFrom = titleSize;
          const bodyTo = doc.content.size;

          const oldBlocks: JsonNode[] = [];
          const oldTexts: string[] = [];
          doc.forEach((node, _offset, index) => {
            if (index === 0) return; // title
            oldBlocks.push(node.toJSON() as JsonNode);
            oldTexts.push(node.textContent.trim());
          });

          const parsed = generateJSON(
            bodyHtml,
            editor.extensionManager.extensions,
          ) as { content?: JsonNode[] };
          const newBlocks = (parsed.content ?? []).filter(Boolean);
          const newTexts = newBlocks.map((b) => textOf(b).trim());

          const parts = diffArrays(oldTexts, newTexts);
          const result: JsonNode[] = [];
          let oi = 0;
          let ni = 0;
          for (const part of parts) {
            const len = part.value.length;
            if (part.removed) {
              for (let k = 0; k < len; k++) {
                result.push(addMark(oldBlocks[oi + k], DELETE));
              }
              oi += len;
            } else if (part.added) {
              for (let k = 0; k < len; k++) {
                result.push(addMark(newBlocks[ni + k], INSERT));
              }
              ni += len;
            } else {
              for (let k = 0; k < len; k++) result.push(newBlocks[ni + k]);
              oi += len;
              ni += len;
            }
          }
          if (result.length === 0) return false;

          const fragment = Fragment.fromJSON(schema, result);
          const tr = state.tr.replaceWith(bodyFrom, bodyTo, fragment);
          if (dispatch) dispatch(tr.scrollIntoView());
          return true;
        },

      previewAiInsert:
        (html: string, atEnd: boolean) =>
        ({ editor, state, dispatch }) => {
          const { schema } = state;
          if (!schema.marks[INSERT]) return false;
          const parsed = generateJSON(
            html,
            editor.extensionManager.extensions,
          ) as { content?: JsonNode[] };
          const blocks = (parsed.content ?? [])
            .filter(Boolean)
            .map((b) => addMark(b, INSERT));
          if (blocks.length === 0) return false;

          const fragment = Fragment.fromJSON(schema, blocks);
          // At end of doc, or after the current top-level block.
          const pos = atEnd
            ? state.doc.content.size
            : state.selection.$to.after(1);
          const tr = state.tr.insert(pos, fragment);
          if (dispatch) dispatch(tr.scrollIntoView());
          return true;
        },

      acceptAiEdit:
        () =>
        ({ editor, state, dispatch }) => {
          const ins = state.schema.marks[INSERT];
          const del = state.schema.marks[DELETE];
          if (!ins || !del) return false;
          const tr = state.tr;
          // Keep added text — just strip the green mark across the whole doc.
          tr.removeMark(0, state.doc.content.size, ins);
          // Drop deleted blocks (computed on the original doc; removeMark
          // doesn't shift positions, and we delete back-to-front).
          const ranges = topLevelNodesWithMark(editor, DELETE);
          for (let i = ranges.length - 1; i >= 0; i--) {
            tr.delete(ranges[i].from, ranges[i].to);
          }
          if (dispatch) dispatch(tr);
          return true;
        },

      rejectAiEdit:
        () =>
        ({ editor, state, dispatch }) => {
          const ins = state.schema.marks[INSERT];
          const del = state.schema.marks[DELETE];
          if (!ins || !del) return false;
          const tr = state.tr;
          // Restore originals — strip the red mark.
          tr.removeMark(0, state.doc.content.size, del);
          // Drop the AI's additions.
          const ranges = topLevelNodesWithMark(editor, INSERT);
          for (let i = ranges.length - 1; i >= 0; i--) {
            tr.delete(ranges[i].from, ranges[i].to);
          }
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
