import "server-only";
import type { Liveblocks } from "@liveblocks/node";
import type { createClient } from "@/lib/supabase/server";

/**
 * Spreadsheet snapshot persistence.
 *
 * Twin of `lib/documents/snapshot.ts` (which handles the Yjs side). Called
 * from the Liveblocks `storageUpdated` webhook for rooms whose document
 * `kind = 'sheet'`. Pulls the room's Storage tree via the Liveblocks REST
 * API and writes a normalized JSON snapshot + a TSV plaintext into the
 * `documents` row.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type SheetSnapshot = {
  columns: Array<{ id: string; width: number }>;
  rows: Array<{ id: string; height: number }>;
  /** `colId:rowId` → raw cell value (string). Sparse — empty cells are absent. */
  cells: Record<string, string>;
};

/**
 * Fetch the room's storage tree and reshape it into the snapshot format we
 * store in Postgres. Uses the REST `getStorageDocument` endpoint (returns
 * the LSON tree) — no need to spin up a client connection.
 */
export async function captureSheetSnapshot(
  liveblocks: Liveblocks,
  roomId: string,
): Promise<SheetSnapshot> {
  const lson = (await liveblocks.getStorageDocument(roomId, "json")) as {
    spreadsheet?: {
      columns?: Array<{ id: string; width: number }>;
      rows?: Array<{ id: string; height: number }>;
      cells?: Record<string, { value: string }>;
    };
  };
  const sheet = lson?.spreadsheet ?? {};
  const columns = (sheet.columns ?? []).map((c) => ({
    id: c.id,
    width: c.width,
  }));
  const rows = (sheet.rows ?? []).map((r) => ({
    id: r.id,
    height: r.height,
  }));
  const cells: Record<string, string> = {};
  for (const [k, v] of Object.entries(sheet.cells ?? {})) {
    if (v?.value) cells[k] = v.value;
  }
  return { columns, rows, cells };
}

/**
 * Build a TSV plaintext from a snapshot. Used to power full-text search via
 * `documents.body_fts`. We render in row-major order, tab-separated columns,
 * newlines between rows. Formula bodies pass through as-typed — searching
 * for `=A2*3` will find the cell that defined it. Resolved refs are kept as
 * `colId:rowId` and stripped, since they're noise for search.
 */
export function sheetSnapshotToText(snapshot: SheetSnapshot): string {
  if (snapshot.columns.length === 0 || snapshot.rows.length === 0) return "";
  const lines: string[] = [];
  for (const row of snapshot.rows) {
    const fields = snapshot.columns.map((col) => {
      const v = snapshot.cells[`${col.id}@${row.id}`] ?? "";
      // Drop tab/newline characters and the noisy `colId@rowId` refs.
      return v
        .replace(/[\t\n\r]+/g, " ")
        .replace(/[A-Za-z0-9_-]+@[A-Za-z0-9_-]+/g, "")
        .trim();
    });
    // Only emit rows with at least one non-empty cell — keeps the search
    // index from being padded with blank lines from a sparsely-used sheet.
    if (fields.some((f) => f.length > 0)) {
      lines.push(fields.join("\t"));
    }
  }
  return lines.join("\n");
}

/**
 * Write the snapshot back to the matching `documents` row. Best-effort —
 * caller catches and logs; the next storageUpdated event will retry.
 */
export async function persistSheetSnapshot(
  supabase: ServerClient,
  documentId: string,
  snapshot: SheetSnapshot,
): Promise<{ ok: true } | { error: string }> {
  const text = sheetSnapshotToText(snapshot);
  const { error } = await supabase
    .from("documents")
    .update({
      sheet_state: snapshot,
      sheet_text: text,
      sheet_updated_at: new Date().toISOString(),
      // Touch updated_at too so the sidebar's "recently edited" sort surfaces
      // the sheet. The DB trigger sets it automatically on any update, so
      // this is just for symmetry with the docs snapshot.
    })
    .eq("id", documentId)
    .eq("kind", "sheet");
  if (error) return { error: error.message };
  return { ok: true };
}
