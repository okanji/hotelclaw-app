import "server-only";
/**
 * Server-side document BODY writer — the missing write half of the doc
 * story. Content lives in the Liveblocks Yjs room (Postgres `body_*` is a
 * derived snapshot), so writing means: sanitized HTML → ProseMirror JSON →
 * `withProsemirrorDocument.setContent` → snapshot back to Postgres → brain
 * mirror. This is seed-demo.mjs's proven recipe extracted for runtime use
 * (the AI control surface calls it via /api/internal/documents/write).
 *
 * REMEMBER: `setContent(string)` inserts literal text — it must be
 * ProseMirror JSON (the seed-demo gotcha).
 */
import { generateHTML, generateJSON } from "@tiptap/html";
import { withProsemirrorDocument } from "@liveblocks/node-prosemirror";
import { getLiveblocksServer } from "@/lib/liveblocks/server";
import { roomIdForDocument } from "@/lib/liveblocks/rooms";
import {
  captureDocumentSnapshot,
  persistDocumentSnapshot,
} from "@/lib/documents/snapshot";
import { sanitizeDocHtml } from "@/lib/ai/bots/doc-bot";
import { WRITE_EXTENSIONS, WRITE_SCHEMA } from "@/lib/documents/editor-schema";
import { syncDocumentToBrain } from "@/lib/brain/doc-sync";
import { createServiceClient } from "@/lib/supabase/server";

// Basic-tag extension set matching doc-bot's ALLOWED_TAGS (headings, lists,
// blockquote, code, tables; StarterKit v3 bundles Link). Custom nodes
// (callout/toggle/chart) are NOT writable from the AI surface — sanitize
// strips them anyway. The SAME set builds both the HTML→JSON conversion and
// the ProseMirror schema passed to Liveblocks: the library default is
// StarterKit-only and rejects table nodes with "Invalid content".
//
// Both now live in lib/documents/editor-schema.ts alongside the READ schema,
// so the write surface and the parse-back surface can be seen together — they
// drifted apart once already and cost every non-StarterKit node in the app.
const EXTENSIONS = WRITE_EXTENSIONS;
const SCHEMA = WRITE_SCHEMA;

type ProseMirrorNode = { type: string; content?: unknown[] };

export function htmlToProseMirrorDoc(html: string): ProseMirrorNode {
  const clean = sanitizeDocHtml(html);
  return generateJSON(clean, EXTENSIONS) as ProseMirrorNode;
}

/**
 * A document's body as clean HTML (from the body_json snapshot, same
 * extension set the writer uses) — the faithful read the AI needs before
 * surgical edits, so unchanged sections round-trip without losing
 * structure (tables, lists). Falls back to paragraph-wrapped body_text
 * for docs whose JSON snapshot predates the webhook.
 */
export async function readDocumentBodyHtml(input: {
  propertyId: string;
  documentId: string;
  /** Read a stashed pre-replace revision instead of the live body. */
  revisionId?: string | null;
}): Promise<
  | { ok: true; title: string; html: string; characters: number }
  | { ok: false; error: string }
> {
  const supabase = createServiceClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, body_json, body_text, archived_at, kind")
    .eq("id", input.documentId)
    .eq("property_id", input.propertyId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found in this property." };
  if (doc.kind !== "doc") {
    return { ok: false, error: "Only rich-text documents are readable this way (not sheets)." };
  }

  let bodyJson: unknown = doc.body_json;
  let bodyText: string = doc.body_text ?? "";
  if (input.revisionId) {
    const { data: rev } = await supabase
      .from("document_ai_revisions")
      .select("body_json, body_text")
      .eq("id", input.revisionId)
      .eq("document_id", input.documentId)
      .maybeSingle();
    if (!rev) return { ok: false, error: "Revision not found for this document." };
    bodyJson = rev.body_json;
    bodyText = rev.body_text ?? "";
  }

  let html = "";
  if (bodyJson) {
    try {
      html = generateHTML(bodyJson as object, EXTENSIONS);
    } catch {
      html = "";
    }
  }
  if (!html) {
    html = bodyText
      .split("\n")
      .filter((line: string) => line.trim())
      .map(
        (line: string) =>
          `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
      )
      .join("");
  }
  return { ok: true, title: doc.title, html, characters: html.length };
}

export type WriteBodyResult =
  | { ok: true; documentId: string; bodyTextLength: number }
  | { ok: false; error: string };

/**
 * Write (replace or append) a document's body. Verifies tenancy, writes
 * the Liveblocks room, persists the Postgres snapshot, and re-mirrors the
 * doc into the property's knowledge brain.
 */
export async function writeDocumentBody(input: {
  propertyId: string;
  documentId: string;
  html: string;
  mode: "replace" | "append";
}): Promise<WriteBodyResult> {
  const supabase = createServiceClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, property_id, kind, archived_at, body_text, body_json")
    .eq("id", input.documentId)
    .eq("property_id", input.propertyId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found in this property." };
  if (doc.archived_at) return { ok: false, error: "Document is archived." };
  if (doc.kind !== "doc") {
    return { ok: false, error: "Only rich-text documents can be written (not sheets)." };
  }

  // Undo safety net (0094): a REPLACE of non-trivial existing content
  // stashes the current snapshot first — the only recovery path once the
  // Liveblocks body and Postgres snapshot are overwritten. Capped at the
  // 10 newest revisions per document.
  if (input.mode === "replace" && (doc.body_text ?? "").trim().length > 80) {
    await supabase.from("document_ai_revisions").insert({
      property_id: input.propertyId,
      document_id: input.documentId,
      body_json: doc.body_json ?? null,
      body_text: doc.body_text ?? "",
      note: "pre-replace snapshot (AI write)",
    });
    const { data: extra } = await supabase
      .from("document_ai_revisions")
      .select("id")
      .eq("document_id", input.documentId)
      .order("replaced_at", { ascending: false })
      .range(10, 50);
    if ((extra ?? []).length > 0) {
      await supabase
        .from("document_ai_revisions")
        .delete()
        .in("id", (extra ?? []).map((r) => r.id));
    }
  }

  const incoming = htmlToProseMirrorDoc(input.html);
  if (!incoming.content || incoming.content.length === 0) {
    return { ok: false, error: "Content produced an empty document." };
  }
  // Top-level blocks as real schema nodes — written one transaction each.
  const blocks = (incoming.content as unknown[]).map((b) =>
    SCHEMA.nodeFromJSON(b),
  );

  const liveblocks = getLiveblocksServer();
  const roomId = roomIdForDocument(input.propertyId, input.documentId);
  await liveblocks.getOrCreateRoom(roomId, { defaultAccesses: [] });

  // PROGRESSIVE, TRANSACTIONAL writing (not whole-body setContent):
  //   • append inserts each block at the CURRENT end via a ProseMirror
  //     transaction — concurrent human edits anywhere in the doc merge
  //     cleanly through Yjs position mapping, nothing is clobbered.
  //   • replace clears once, then streams blocks in one-by-one. A human's
  //     concurrent keystroke during the clear itself is the only loss
  //     window (and the pre-replace revision stash covers recovery).
  //   • Each update() syncs through Yjs individually, so anyone viewing
  //     the doc (chat split-panel, editor tab) literally watches the AI
  //     write section by section.
  // Group huge docs so total round-trips stay bounded (each update() is a
  // Liveblocks sync); typical docs stream block-by-block.
  const GROUP_TARGET = 24;
  const groupSize = Math.max(1, Math.ceil(blocks.length / GROUP_TARGET));
  const groups: (typeof blocks)[] = [];
  for (let i = 0; i < blocks.length; i += groupSize) {
    groups.push(blocks.slice(i, i + groupSize));
  }
  const paceMs = groups.length > 15 ? 80 : 180;

  await withProsemirrorDocument(
    { client: liveblocks, roomId, schema: SCHEMA },
    async (api) => {
      if (input.mode === "replace") {
        await api.update((doc, tr) => tr.delete(0, doc.content.size));
      }
      for (const group of groups) {
        await api.update((doc, tr) => {
          let out = tr;
          for (const block of group) {
            out = out.insert(out.doc.content.size, block);
          }
          return out;
        });
        await new Promise((resolve) => setTimeout(resolve, paceMs));
      }
    },
  );

  const snapshot = await captureDocumentSnapshot(liveblocks, roomId);
  const persisted = await persistDocumentSnapshot(
    supabase,
    input.documentId,
    snapshot,
  );
  if ("error" in persisted) {
    return { ok: false, error: `Snapshot persist failed: ${persisted.error}` };
  }

  // Mirror into the knowledge brain right away (the webhook would also
  // catch up, but the bot may search for this content seconds later).
  await syncDocumentToBrain(input.documentId);

  return {
    ok: true,
    documentId: input.documentId,
    bodyTextLength: snapshot.bodyText.length,
  };
}
