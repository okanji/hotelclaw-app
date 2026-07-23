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
import { generateJSON } from "@tiptap/html";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { withProsemirrorDocument } from "@liveblocks/node-prosemirror";
import { getLiveblocksServer } from "@/lib/liveblocks/server";
import { roomIdForDocument } from "@/lib/liveblocks/rooms";
import {
  captureDocumentSnapshot,
  persistDocumentSnapshot,
} from "@/lib/documents/snapshot";
import { sanitizeDocHtml } from "@/lib/ai/bots/doc-bot";
import { syncDocumentToBrain } from "@/lib/brain/doc-sync";
import { createServiceClient } from "@/lib/supabase/server";

// Basic-tag extension set matching doc-bot's ALLOWED_TAGS (headings, lists,
// blockquote, code, tables; StarterKit v3 bundles Link). Custom nodes
// (callout/toggle/chart) are NOT writable from the AI surface — sanitize
// strips them anyway. The SAME set builds both the HTML→JSON conversion and
// the ProseMirror schema passed to Liveblocks: the library default is
// StarterKit-only and rejects table nodes with "Invalid content".
const EXTENSIONS = [StarterKit, Table, TableRow, TableCell, TableHeader];
const SCHEMA = getSchema(EXTENSIONS);

type ProseMirrorNode = { type: string; content?: unknown[] };

export function htmlToProseMirrorDoc(html: string): ProseMirrorNode {
  const clean = sanitizeDocHtml(html);
  return generateJSON(clean, EXTENSIONS) as ProseMirrorNode;
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
    .select("id, property_id, kind, archived_at")
    .eq("id", input.documentId)
    .eq("property_id", input.propertyId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found in this property." };
  if (doc.archived_at) return { ok: false, error: "Document is archived." };
  if (doc.kind !== "doc") {
    return { ok: false, error: "Only rich-text documents can be written (not sheets)." };
  }

  const incoming = htmlToProseMirrorDoc(input.html);
  if (!incoming.content || incoming.content.length === 0) {
    return { ok: false, error: "Content produced an empty document." };
  }

  const liveblocks = getLiveblocksServer();
  const roomId = roomIdForDocument(input.propertyId, input.documentId);
  await liveblocks.getOrCreateRoom(roomId, { defaultAccesses: [] });

  await withProsemirrorDocument(
    { client: liveblocks, roomId, schema: SCHEMA },
    async (api) => {
      if (input.mode === "append") {
        const current = api.toJSON() as ProseMirrorNode;
        const merged: ProseMirrorNode = {
          type: "doc",
          content: [...(current.content ?? []), ...(incoming.content ?? [])],
        };
        await api.setContent(merged);
      } else {
        await api.setContent(incoming);
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
