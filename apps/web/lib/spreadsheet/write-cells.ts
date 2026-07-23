import "server-only";
/**
 * Server-side spreadsheet cell writer — the AI control surface's path into
 * sheet documents. Sheet content lives in Liveblocks STORAGE (a `workbook`
 * LiveObject: sheets LiveList → per-sheet cells LiveMap keyed by
 * `colId@rowId` — see lib/spreadsheet/initial.ts), so writes go through
 * `liveblocks.mutateStorage` and land live for anyone viewing the sheet.
 * A1 references ("B3") are translated to the reorder-safe cell ids via the
 * sheet's column/row id arrays. After writing, the Postgres snapshot is
 * refreshed so search/`sheet_text` stay current.
 */
import { LiveObject } from "@liveblocks/node";
import { getLiveblocksServer } from "@/lib/liveblocks/server";
import { roomIdForDocument } from "@/lib/liveblocks/rooms";
import {
  captureSheetSnapshot,
  persistSheetSnapshot,
} from "@/lib/spreadsheet/snapshot";
import { encodeCellId } from "@/lib/spreadsheet/cell-id";
import { createServiceClient } from "@/lib/supabase/server";

/** Parse "B3" → zero-based {col, row}. */
function parseA1(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = parseInt(m[2], 10);
  if (row < 1) return null;
  return { col: col - 1, row: row - 1 };
}

export type SheetCellWrite = { ref: string; value: string };

export async function writeSheetCells(input: {
  propertyId: string;
  documentId: string;
  /** Sheet tab by title; omit for the first sheet. */
  sheetTitle?: string | null;
  cells: SheetCellWrite[];
}): Promise<
  | { ok: true; written: number; sheetTitle: string }
  | { ok: false; error: string }
> {
  const supabase = createServiceClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, kind, archived_at")
    .eq("id", input.documentId)
    .eq("property_id", input.propertyId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found in this property." };
  if (doc.kind !== "sheet") return { ok: false, error: "Not a spreadsheet document." };
  if (doc.archived_at) return { ok: false, error: "Document is archived." };

  const liveblocks = getLiveblocksServer();
  const roomId = roomIdForDocument(input.propertyId, input.documentId);

  let outcome: { ok: true; written: number; sheetTitle: string } | { ok: false; error: string } = {
    ok: false,
    error: "storage mutation did not run",
  };

  await liveblocks.mutateStorage(roomId, ({ root }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const workbook = (root as any).get("workbook");
    if (!workbook) {
      outcome = { ok: false, error: "Sheet has no workbook storage yet (open it once in the app)." };
      return;
    }
    const sheets = workbook.get("sheets");
    const count: number = sheets?.length ?? 0;
    let sheet: any = null;
    for (let i = 0; i < count; i++) {
      const s = sheets.get(i);
      if (
        !input.sheetTitle ||
        String(s.get("title") ?? "").toLowerCase() === input.sheetTitle.toLowerCase()
      ) {
        sheet = s;
        break;
      }
    }
    if (!sheet) {
      outcome = { ok: false, error: `No sheet tab named "${input.sheetTitle}".` };
      return;
    }
    const columns = sheet.get("columns");
    const rows = sheet.get("rows");
    const cells = sheet.get("cells");
    const columnIds: string[] = [];
    for (let i = 0; i < (columns?.length ?? 0); i++) columnIds.push(columns.get(i).get("id"));
    const rowIds: string[] = [];
    for (let i = 0; i < (rows?.length ?? 0); i++) rowIds.push(rows.get(i).get("id"));

    let written = 0;
    for (const w of input.cells) {
      const pos = parseA1(w.ref);
      if (!pos) {
        outcome = { ok: false, error: `Invalid cell reference "${w.ref}" (use A1 style).` };
        return;
      }
      if (pos.col >= columnIds.length || pos.row >= rowIds.length) {
        outcome = {
          ok: false,
          error: `"${w.ref}" is outside the sheet (${columnIds.length} cols × ${rowIds.length} rows).`,
        };
        return;
      }
      const cellId = encodeCellId(columnIds[pos.col], rowIds[pos.row]);
      const existing = cells.get(cellId);
      if (existing) {
        existing.set("value", w.value);
      } else {
        cells.set(cellId, new LiveObject({ value: w.value }));
      }
      written += 1;
    }
    outcome = { ok: true, written, sheetTitle: String(sheet.get("title") ?? "Sheet 1") };
  });

  if (outcome.ok) {
    // Refresh the Postgres snapshot (sheet_state + sheet_text → body_fts).
    const snapshot = await captureSheetSnapshot(liveblocks, roomId);
    await persistSheetSnapshot(supabase, input.documentId, snapshot);
  }
  return outcome;
}
