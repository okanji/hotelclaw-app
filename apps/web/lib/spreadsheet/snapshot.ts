import "server-only";
import type { Liveblocks } from "@liveblocks/node";
import type { createClient } from "@/lib/supabase/server";

/**
 * Workbook snapshot persistence.
 *
 * Twin of `lib/documents/snapshot.ts` (which handles the Yjs side). Called
 * from the Liveblocks `storageUpdated` webhook for rooms whose document
 * `kind = 'sheet'`. Pulls the room's Storage tree via the Liveblocks REST
 * API and writes a normalized JSON snapshot + a TSV plaintext into the
 * `documents` row.
 *
 * Supports BOTH shapes for one release:
 *   - new: `storage.workbook` with N sheets
 *   - legacy: `storage.spreadsheet` (single-sheet)
 *
 * Legacy rooms are migrated to `workbook` on first edit by `useMigrateLegacy`;
 * after that, all rooms emit the new shape via this webhook.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type SheetSnapshotEntry = {
  id: string;
  title: string;
  color?: string;
  columns: Array<{ id: string; width: number; hidden?: boolean }>;
  rows: Array<{ id: string; height: number; hidden?: boolean }>;
  /** `colId@rowId` → raw cell value (string). Sparse — empty cells absent. */
  cells: Record<string, string>;
  merges: Record<string, string>;
  frozenRows: number;
  frozenColumns: number;
};

export type WorkbookSnapshot = {
  activeSheetId: string;
  sheets: SheetSnapshotEntry[];
  namedRanges: Record<
    string,
    { sheetId: string; startRef: string; endRef: string }
  >;
};

type StorageJsonShape = {
  workbook?: {
    activeSheetId?: string;
    sheets?: Array<{
      id?: string;
      title?: string;
      color?: string;
      columns?: Array<{ id: string; width: number; hidden?: boolean }>;
      rows?: Array<{ id: string; height: number; hidden?: boolean }>;
      cells?: Record<string, { value: string }>;
      merges?: Record<string, string>;
      frozenRows?: number;
      frozenColumns?: number;
    }>;
    namedRanges?: Record<
      string,
      { sheetId: string; startRef: string; endRef: string }
    >;
  };
  spreadsheet?: {
    columns?: Array<{ id: string; width: number }>;
    rows?: Array<{ id: string; height: number }>;
    cells?: Record<string, { value: string }>;
  };
};

export async function captureSheetSnapshot(
  liveblocks: Liveblocks,
  roomId: string,
): Promise<WorkbookSnapshot> {
  const lson = (await liveblocks.getStorageDocument(
    roomId,
    "json",
  )) as StorageJsonShape;

  // Prefer the workbook shape. Fall back to legacy if present.
  if (lson?.workbook?.sheets) {
    return normalizeWorkbook(lson.workbook);
  }
  if (lson?.spreadsheet) {
    return legacyToWorkbook(lson.spreadsheet);
  }
  return { activeSheetId: "", sheets: [], namedRanges: {} };
}

function normalizeWorkbook(
  workbook: NonNullable<StorageJsonShape["workbook"]>,
): WorkbookSnapshot {
  const sheets: SheetSnapshotEntry[] = (workbook.sheets ?? []).map((s) => {
    const cells: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.cells ?? {})) {
      if (v?.value) cells[k] = v.value;
    }
    return {
      id: s.id ?? "",
      title: s.title ?? "Sheet",
      color: s.color,
      columns: (s.columns ?? []).map((c) => ({
        id: c.id,
        width: c.width,
        hidden: c.hidden,
      })),
      rows: (s.rows ?? []).map((r) => ({
        id: r.id,
        height: r.height,
        hidden: r.hidden,
      })),
      cells,
      merges: { ...(s.merges ?? {}) },
      frozenRows: s.frozenRows ?? 0,
      frozenColumns: s.frozenColumns ?? 0,
    };
  });
  return {
    activeSheetId: workbook.activeSheetId ?? sheets[0]?.id ?? "",
    sheets,
    namedRanges: { ...(workbook.namedRanges ?? {}) },
  };
}

function legacyToWorkbook(
  legacy: NonNullable<StorageJsonShape["spreadsheet"]>,
): WorkbookSnapshot {
  const cells: Record<string, string> = {};
  for (const [k, v] of Object.entries(legacy.cells ?? {})) {
    if (v?.value) cells[k] = v.value;
  }
  const sheetId = "legacy";
  return {
    activeSheetId: sheetId,
    sheets: [
      {
        id: sheetId,
        title: "Sheet 1",
        columns: (legacy.columns ?? []).map((c) => ({
          id: c.id,
          width: c.width,
        })),
        rows: (legacy.rows ?? []).map((r) => ({
          id: r.id,
          height: r.height,
        })),
        cells,
        merges: {},
        frozenRows: 0,
        frozenColumns: 0,
      },
    ],
    namedRanges: {},
  };
}

/**
 * Build a TSV plaintext from the whole workbook for full-text search. Each
 * sheet is prefixed by its title so search results carry per-sheet context.
 * Formula refs (`colId@rowId`) are stripped since they're noise.
 */
export function sheetSnapshotToText(snapshot: WorkbookSnapshot): string {
  const parts: string[] = [];
  for (const sheet of snapshot.sheets) {
    if (sheet.columns.length === 0 || sheet.rows.length === 0) continue;
    parts.push(`# ${sheet.title}`);
    for (const row of sheet.rows) {
      const fields = sheet.columns.map((col) => {
        const v = sheet.cells[`${col.id}@${row.id}`] ?? "";
        return v
          .replace(/[\t\n\r]+/g, " ")
          .replace(/[A-Za-z0-9_-]+@[A-Za-z0-9_-]+/g, "")
          .trim();
      });
      if (fields.some((f) => f.length > 0)) {
        parts.push(fields.join("\t"));
      }
    }
    parts.push(""); // blank line between sheets
  }
  return parts.join("\n");
}

export async function persistSheetSnapshot(
  supabase: ServerClient,
  documentId: string,
  snapshot: WorkbookSnapshot,
): Promise<{ ok: true } | { error: string }> {
  const text = sheetSnapshotToText(snapshot);
  const { error } = await supabase
    .from("documents")
    .update({
      sheet_state: snapshot,
      sheet_text: text,
      sheet_updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("kind", "sheet");
  if (error) return { error: error.message };
  return { ok: true };
}
