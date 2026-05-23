"use client";

/**
 * Storage mutation hooks for the workbook.
 *
 * All cell/column/row hooks take a `sheetId` as their first argument so the
 * mutation knows which sheet inside the workbook to operate on. The surface
 * threads `activeSheetId` into every call.
 *
 * Liveblocks' modern React API runs each `useMutation` body inside an
 * implicit batch, so multi-step changes (deleteColumn wiping every cell in
 * that column) commit as one op + one undo entry.
 *
 * Legacy migration: rooms that still have `storage.spreadsheet` (the
 * pre-workbook shape) get auto-promoted on first write via `useMigrate`.
 * Surface calls `migrate()` when it detects legacy storage; all subsequent
 * mutations operate on the promoted workbook.
 */

import { LiveList, LiveMap, LiveObject } from "@liveblocks/client";
import { useMutation } from "@liveblocks/react";
import { nanoid } from "nanoid";
import type { CellFormat } from "@/liveblocks.config";
import { buildSheet, rewriteA1Refs } from "./initial";
import { encodeCellId } from "./cell-id";
import {
  COLUMN_DEFAULT_WIDTH,
  ID_LENGTH,
  ROW_DEFAULT_HEIGHT,
} from "./constants";

// ── Sheet lookup ────────────────────────────────────────────────────────────

type WorkbookStorage = NonNullable<Liveblocks["Storage"]["workbook"]>;
type SheetEntry = ReturnType<
  WorkbookStorage["get"] extends (k: "sheets") => infer L ? never : never
>;

/**
 * Find a sheet LiveObject inside the workbook by id. Returns `null` when the
 * sheet has been deleted concurrently. All hooks guard on the null branch
 * so a stale `activeSheetId` never crashes a mutation.
 */
function findSheet(
  workbook: NonNullable<Liveblocks["Storage"]["workbook"]>,
  sheetId: string,
) {
  const sheets = workbook.get("sheets");
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets.get(i);
    if (s && s.get("id") === sheetId) return s;
  }
  return null;
}

function findSheetIndex(
  workbook: NonNullable<Liveblocks["Storage"]["workbook"]>,
  sheetId: string,
): number {
  const sheets = workbook.get("sheets");
  for (let i = 0; i < sheets.length; i++) {
    if (sheets.get(i)?.get("id") === sheetId) return i;
  }
  return -1;
}

// ── Legacy migration ────────────────────────────────────────────────────────

/**
 * One-shot migration: if `storage.spreadsheet` is present and
 * `storage.workbook` is absent, promote the legacy single-sheet payload to
 * a workbook with one sheet. Idempotent — called from the surface on first
 * detect; running it again no-ops.
 */
export function useMigrateLegacy() {
  return useMutation(({ storage }) => {
    const existing = storage.get("workbook");
    if (existing) return;
    const legacy = storage.get("spreadsheet");
    if (!legacy) {
      // Nothing to migrate — initialize an empty workbook.
      const sheet = buildSheet({ title: "Sheet 1" });
      storage.set(
        "workbook",
        new LiveObject({
          activeSheetId: sheet.get("id"),
          sheets: new LiveList([sheet]),
          namedRanges: new LiveMap<
            string,
            { sheetId: string; startRef: string; endRef: string }
          >(),
          charts: new LiveList([]),
        }),
      );
      return;
    }
    // Move the legacy cells/columns/rows into a fresh sheet LiveObject. We
    // can't reuse the existing LiveObjects because they're already attached
    // to their parent — so we clone their plain JSON.
    const legacyColumns = legacy.get("columns");
    const legacyRows = legacy.get("rows");
    const legacyCells = legacy.get("cells");

    const newColumns: LiveObject<{ id: string; width: number; hidden?: boolean }>[] = [];
    for (let i = 0; i < legacyColumns.length; i++) {
      const c = legacyColumns.get(i)!;
      newColumns.push(
        new LiveObject({ id: c.get("id"), width: c.get("width") }),
      );
    }
    const newRows: LiveObject<{ id: string; height: number; hidden?: boolean }>[] = [];
    for (let i = 0; i < legacyRows.length; i++) {
      const r = legacyRows.get(i)!;
      newRows.push(
        new LiveObject({ id: r.get("id"), height: r.get("height") }),
      );
    }
    const newCells = new LiveMap<
      string,
      LiveObject<{ value: string; format?: CellFormat }>
    >();
    legacyCells.forEach((cell, key) => {
      newCells.set(
        key,
        new LiveObject({ value: cell.get("value"), format: cell.get("format") }),
      );
    });

    const sheet = new LiveObject({
      id: nanoid(ID_LENGTH),
      title: "Sheet 1",
      color: undefined,
      cells: newCells,
      columns: new LiveList(newColumns),
      rows: new LiveList(newRows),
      merges: new LiveMap<string, string>(),
      frozenRows: 0,
      frozenColumns: 0,
    });

    storage.set(
      "workbook",
      new LiveObject({
        activeSheetId: sheet.get("id"),
        sheets: new LiveList([sheet]),
        namedRanges: new LiveMap<
          string,
          { sheetId: string; startRef: string; endRef: string }
        >(),
        charts: new LiveList([]),
      }),
    );
    storage.delete("spreadsheet");
  }, []);
}

// ── Workbook-level mutations ────────────────────────────────────────────────

/** Add a new blank sheet to the workbook. Returns nothing; surface calls
 *  `useSetActiveSheet(newId)` after. */
export function useAddSheet() {
  return useMutation(({ storage }, title?: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const sheets = workbook.get("sheets");
    const next = title ?? `Sheet ${sheets.length + 1}`;
    const sheet = buildSheet({ title: next });
    sheets.push(sheet);
    workbook.set("activeSheetId", sheet.get("id"));
  }, []);
}

export function useDeleteSheet() {
  return useMutation(({ storage }, sheetId: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const sheets = workbook.get("sheets");
    if (sheets.length <= 1) return; // never delete the last sheet
    const idx = findSheetIndex(workbook, sheetId);
    if (idx < 0) return;
    sheets.delete(idx);
    // If we deleted the active sheet, switch to the previous (or first).
    if (workbook.get("activeSheetId") === sheetId) {
      const next = sheets.get(Math.max(0, idx - 1));
      if (next) workbook.set("activeSheetId", next.get("id"));
    }
  }, []);
}

export function useRenameSheet() {
  return useMutation(({ storage }, sheetId: string, title: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const sheet = findSheet(workbook, sheetId);
    if (!sheet) return;
    sheet.set("title", title.slice(0, 60));
  }, []);
}

export function useDuplicateSheet() {
  return useMutation(({ storage }, sheetId: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const source = findSheet(workbook, sheetId);
    if (!source) return;
    const idx = findSheetIndex(workbook, sheetId);

    // Build a clone by serializing each component to plain values then
    // reconstructing LiveObjects. LiveObject doesn't have a deep-clone
    // primitive for cross-tree moves.
    const sourceColumns = source.get("columns");
    const sourceRows = source.get("rows");
    const sourceCells = source.get("cells");
    const sourceMerges = source.get("merges");

    const newColumns: LiveObject<{ id: string; width: number; hidden?: boolean }>[] = [];
    for (let i = 0; i < sourceColumns.length; i++) {
      const c = sourceColumns.get(i)!;
      newColumns.push(
        new LiveObject({
          id: nanoid(ID_LENGTH),
          width: c.get("width"),
          hidden: c.get("hidden"),
        }),
      );
    }
    const newRows: LiveObject<{ id: string; height: number; hidden?: boolean }>[] = [];
    for (let i = 0; i < sourceRows.length; i++) {
      const r = sourceRows.get(i)!;
      newRows.push(
        new LiveObject({
          id: nanoid(ID_LENGTH),
          height: r.get("height"),
          hidden: r.get("hidden"),
        }),
      );
    }
    // Remap cells: we generated new col/row ids so old cell ids point
    // nowhere. Build the new cells map by walking the original and
    // translating ids.
    const oldColIds = (() => {
      const a: string[] = [];
      for (let i = 0; i < sourceColumns.length; i++)
        a.push(sourceColumns.get(i)!.get("id"));
      return a;
    })();
    const oldRowIds = (() => {
      const a: string[] = [];
      for (let i = 0; i < sourceRows.length; i++)
        a.push(sourceRows.get(i)!.get("id"));
      return a;
    })();
    const newColIds = newColumns.map((c) => c.get("id"));
    const newRowIds = newRows.map((r) => r.get("id"));
    const colMap = new Map<string, string>();
    const rowMap = new Map<string, string>();
    oldColIds.forEach((oid, i) => colMap.set(oid, newColIds[i]!));
    oldRowIds.forEach((oid, i) => rowMap.set(oid, newRowIds[i]!));

    const newCells = new LiveMap<
      string,
      LiveObject<{ value: string; format?: CellFormat }>
    >();
    sourceCells.forEach((cell, key) => {
      const at = key.indexOf("@");
      if (at <= 0) return;
      const newColId = colMap.get(key.slice(0, at));
      const newRowId = rowMap.get(key.slice(at + 1));
      if (!newColId || !newRowId) return;
      const newKey = encodeCellId(newColId, newRowId);
      // Translate cell-id refs inside the value (formulas referencing other
      // cells in this same sheet need their refs remapped too).
      const rawValue = cell.get("value");
      const remapped = rawValue.replace(
        /([A-Za-z0-9_-]+)@([A-Za-z0-9_-]+)/g,
        (m, c, r) => {
          const nc = colMap.get(c);
          const nr = rowMap.get(r);
          return nc && nr ? `${nc}@${nr}` : m;
        },
      );
      newCells.set(
        newKey,
        new LiveObject({ value: remapped, format: cell.get("format") }),
      );
    });

    const newMerges = new LiveMap<string, string>();
    sourceMerges.forEach((bottomRight, topLeft) => {
      const tlAt = topLeft.indexOf("@");
      const brAt = bottomRight.indexOf("@");
      if (tlAt <= 0 || brAt <= 0) return;
      const newTl = `${colMap.get(topLeft.slice(0, tlAt))}@${rowMap.get(topLeft.slice(tlAt + 1))}`;
      const newBr = `${colMap.get(bottomRight.slice(0, brAt))}@${rowMap.get(bottomRight.slice(brAt + 1))}`;
      newMerges.set(newTl, newBr);
    });

    const dup = new LiveObject({
      id: nanoid(ID_LENGTH),
      title: `${source.get("title")} (copy)`,
      color: source.get("color"),
      cells: newCells,
      columns: new LiveList(newColumns),
      rows: new LiveList(newRows),
      merges: newMerges,
      frozenRows: source.get("frozenRows"),
      frozenColumns: source.get("frozenColumns"),
    });

    workbook.get("sheets").insert(dup, idx + 1);
  }, []);
}

export function useReorderSheet() {
  return useMutation(({ storage }, from: number, to: number) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    workbook.get("sheets").move(from, to);
  }, []);
}

export function useSetActiveSheet() {
  return useMutation(({ storage }, sheetId: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    workbook.set("activeSheetId", sheetId);
  }, []);
}

export function useSetSheetColor() {
  return useMutation(({ storage }, sheetId: string, color: string | null) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const sheet = findSheet(workbook, sheetId);
    if (!sheet) return;
    sheet.set("color", color ?? undefined);
  }, []);
}

// ── Column / row mutations ──────────────────────────────────────────────────

export function useInsertColumn() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      index: number,
      width: number = COLUMN_DEFAULT_WIDTH,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      sheet
        .get("columns")
        .insert(new LiveObject({ id: nanoid(ID_LENGTH), width }), index);
    },
    [],
  );
}

export function useInsertRow() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      index: number,
      height: number = ROW_DEFAULT_HEIGHT,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      sheet
        .get("rows")
        .insert(new LiveObject({ id: nanoid(ID_LENGTH), height }), index);
    },
    [],
  );
}

export function useDeleteColumn() {
  return useMutation(({ storage }, sheetId: string, index: number) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const sheet = findSheet(workbook, sheetId);
    if (!sheet) return;
    const columns = sheet.get("columns");
    const rows = sheet.get("rows");
    const cells = sheet.get("cells");
    const col = columns.get(index);
    if (!col) return;
    const colId = col.get("id");
    for (let y = 0; y < rows.length; y++) {
      const rowId = rows.get(y)!.get("id");
      cells.delete(encodeCellId(colId, rowId));
    }
    columns.delete(index);
  }, []);
}

export function useDeleteRow() {
  return useMutation(({ storage }, sheetId: string, index: number) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const sheet = findSheet(workbook, sheetId);
    if (!sheet) return;
    const columns = sheet.get("columns");
    const rows = sheet.get("rows");
    const cells = sheet.get("cells");
    const row = rows.get(index);
    if (!row) return;
    const rowId = row.get("id");
    for (let x = 0; x < columns.length; x++) {
      const colId = columns.get(x)!.get("id");
      cells.delete(encodeCellId(colId, rowId));
    }
    rows.delete(index);
  }, []);
}

export function useMoveColumn() {
  return useMutation(
    ({ storage }, sheetId: string, from: number, to: number) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      sheet.get("columns").move(from, to);
    },
    [],
  );
}

export function useMoveRow() {
  return useMutation(
    ({ storage }, sheetId: string, from: number, to: number) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      sheet.get("rows").move(from, to);
    },
    [],
  );
}

export function useResizeColumn() {
  return useMutation(
    ({ storage }, sheetId: string, index: number, width: number) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const col = sheet.get("columns").get(index);
      if (!col) return;
      col.set("width", width);
    },
    [],
  );
}

export function useResizeRow() {
  return useMutation(
    ({ storage }, sheetId: string, index: number, height: number) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const row = sheet.get("rows").get(index);
      if (!row) return;
      row.set("height", height);
    },
    [],
  );
}

export function useToggleHideColumn() {
  return useMutation(
    ({ storage }, sheetId: string, index: number, hidden: boolean) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const col = sheet.get("columns").get(index);
      if (!col) return;
      col.set("hidden", hidden || undefined);
    },
    [],
  );
}

export function useToggleHideRow() {
  return useMutation(
    ({ storage }, sheetId: string, index: number, hidden: boolean) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const row = sheet.get("rows").get(index);
      if (!row) return;
      row.set("hidden", hidden || undefined);
    },
    [],
  );
}

export function useSetFreeze() {
  return useMutation(
    ({ storage }, sheetId: string, frozenRows: number, frozenColumns: number) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      sheet.set("frozenRows", Math.max(0, frozenRows));
      sheet.set("frozenColumns", Math.max(0, frozenColumns));
    },
    [],
  );
}

// ── Cell mutations ──────────────────────────────────────────────────────────

export function useSetCellValue() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      columnId: string,
      rowId: string,
      rawInput: string,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const cells = sheet.get("cells");
      const id = encodeCellId(columnId, rowId);
      if (rawInput === "") {
        cells.delete(id);
        return;
      }
      const columnIds = sheet
        .get("columns")
        .map((c) => c.get("id"));
      const rowIds = sheet
        .get("rows")
        .map((r) => r.get("id"));
      const value = rewriteA1Refs(rawInput, columnIds, rowIds);
      const cell = cells.get(id);
      if (cell == null) {
        cells.set(id, new LiveObject({ value }));
      } else {
        cell.set("value", value);
      }
    },
    [],
  );
}

export function usePasteRange() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      topLeft: { columnId: string; rowId: string },
      matrix: ReadonlyArray<ReadonlyArray<string>>,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const cells = sheet.get("cells");
      const colIds = sheet.get("columns").map((c) => c.get("id"));
      const rowIds = sheet.get("rows").map((r) => r.get("id"));
      const startX = colIds.indexOf(topLeft.columnId);
      const startY = rowIds.indexOf(topLeft.rowId);
      if (startX < 0 || startY < 0) return;

      for (let dy = 0; dy < matrix.length; dy++) {
        const row = matrix[dy];
        if (!row) continue;
        const y = startY + dy;
        const rowId = rowIds[y];
        if (!rowId) break;
        for (let dx = 0; dx < row.length; dx++) {
          const x = startX + dx;
          const colId = colIds[x];
          if (!colId) break;
          const rawInput = row[dx] ?? "";
          const id = encodeCellId(colId, rowId);
          if (rawInput === "") {
            cells.delete(id);
            continue;
          }
          const value = rewriteA1Refs(rawInput, colIds, rowIds);
          const cell = cells.get(id);
          if (cell == null) {
            cells.set(id, new LiveObject({ value }));
          } else {
            cell.set("value", value);
          }
        }
      }
    },
    [],
  );
}

export function useClearCells() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      addresses: ReadonlyArray<{ columnId: string; rowId: string }>,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const cells = sheet.get("cells");
      for (const a of addresses) {
        cells.delete(encodeCellId(a.columnId, a.rowId));
      }
    },
    [],
  );
}

export function useSetCellFormat() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      addresses: ReadonlyArray<{ columnId: string; rowId: string }>,
      patch: Partial<CellFormat>,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const cells = sheet.get("cells");
      for (const a of addresses) {
        const id = encodeCellId(a.columnId, a.rowId);
        const cell = cells.get(id);
        if (cell == null) {
          cells.set(
            id,
            new LiveObject({ value: "", format: cleanPatch(patch) }),
          );
        } else {
          const current = cell.get("format") ?? {};
          const merged: CellFormat = { ...current, ...patch };
          for (const k of Object.keys(merged) as (keyof CellFormat)[]) {
            if (merged[k] === undefined || merged[k] === null) delete merged[k];
          }
          cell.set("format", merged);
        }
      }
    },
    [],
  );
}

function cleanPatch(patch: Partial<CellFormat>): CellFormat {
  const out: CellFormat = {};
  for (const [k, v] of Object.entries(patch) as Array<[
    keyof CellFormat,
    CellFormat[keyof CellFormat],
  ]>) {
    if (v !== undefined && v !== null) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

// ── Cell merge ─────────────────────────────────────────────────────────────

export function useMergeCells() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      topLeft: { columnId: string; rowId: string },
      bottomRight: { columnId: string; rowId: string },
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const merges = sheet.get("merges");
      const tlKey = encodeCellId(topLeft.columnId, topLeft.rowId);
      const brKey = encodeCellId(bottomRight.columnId, bottomRight.rowId);
      // Remove any merge that overlaps the new region. For v1, we just
      // clear merges whose top-left equals the new region's top-left.
      // A more thorough overlap check can come later.
      merges.set(tlKey, brKey);
    },
    [],
  );
}

export function useUnmergeCells() {
  return useMutation(
    ({ storage }, sheetId: string, topLeftCellId: string) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      sheet.get("merges").delete(topLeftCellId);
    },
    [],
  );
}

// ── Sort + AutoFill ─────────────────────────────────────────────────────────

export function useSortColumn() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      columnIndex: number,
      direction: "asc" | "desc",
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const columns = sheet.get("columns");
      const rows = sheet.get("rows");
      const cells = sheet.get("cells");
      const col = columns.get(columnIndex);
      if (!col) return;
      const colId = col.get("id");
      const values: Array<{ rowId: string; value: string }> = [];
      for (let y = 0; y < rows.length; y++) {
        const rowId = rows.get(y)!.get("id");
        const id = encodeCellId(colId, rowId);
        const c = cells.get(id);
        const v = c?.get("value") ?? "";
        if (v !== "") values.push({ rowId, value: v });
      }
      values.sort((a, b) => {
        const na = Number(a.value);
        const nb = Number(b.value);
        const bothNum = Number.isFinite(na) && Number.isFinite(nb);
        if (bothNum) return direction === "asc" ? na - nb : nb - na;
        return direction === "asc"
          ? a.value.localeCompare(b.value)
          : b.value.localeCompare(a.value);
      });
      const sortedValues = values.map((v) => v.value);
      for (let y = 0; y < rows.length; y++) {
        const rowId = rows.get(y)!.get("id");
        const newValue = y < sortedValues.length ? sortedValues[y]! : "";
        const id = encodeCellId(colId, rowId);
        if (newValue === "") {
          cells.delete(id);
        } else {
          const existing = cells.get(id);
          if (existing == null) {
            cells.set(id, new LiveObject({ value: newValue }));
          } else {
            existing.set("value", newValue);
          }
        }
      }
    },
    [],
  );
}

export function useAutoFill() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      seedTopLeft: { columnId: string; rowId: string },
      seedBottomRight: { columnId: string; rowId: string },
      targetTopLeft: { columnId: string; rowId: string },
      targetBottomRight: { columnId: string; rowId: string },
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const cells = sheet.get("cells");
      const colIds = sheet.get("columns").map((c) => c.get("id"));
      const rowIds = sheet.get("rows").map((r) => r.get("id"));

      const sx = colIds.indexOf(seedTopLeft.columnId);
      const sy = rowIds.indexOf(seedTopLeft.rowId);
      const ex = colIds.indexOf(seedBottomRight.columnId);
      const ey = rowIds.indexOf(seedBottomRight.rowId);
      const tx = colIds.indexOf(targetTopLeft.columnId);
      const ty = rowIds.indexOf(targetTopLeft.rowId);
      const tex = colIds.indexOf(targetBottomRight.columnId);
      const tey = rowIds.indexOf(targetBottomRight.rowId);
      if ([sx, sy, ex, ey, tx, ty, tex, tey].some((v) => v < 0)) return;

      const seedWidth = ex - sx + 1;
      const seedHeight = ey - sy + 1;

      function readSeed(localX: number, localY: number): string {
        const cx = colIds[sx + localX]!;
        const cy = rowIds[sy + localY]!;
        return cells.get(encodeCellId(cx, cy))?.get("value") ?? "";
      }

      const seedValues: string[] = [];
      for (let i = 0; i < Math.max(seedWidth, seedHeight); i++) {
        if (seedWidth === 1) seedValues.push(readSeed(0, i));
        else if (seedHeight === 1) seedValues.push(readSeed(i, 0));
      }
      const isProgression =
        (seedWidth === 1 || seedHeight === 1) &&
        seedValues.length >= 2 &&
        seedValues.every((v) => Number.isFinite(Number(v)));
      const step = isProgression
        ? Number(seedValues[1]) - Number(seedValues[0])
        : 0;
      const first = isProgression ? Number(seedValues[0]) : 0;

      for (let y = ty; y <= tey; y++) {
        for (let x = tx; x <= tex; x++) {
          if (x >= sx && x <= ex && y >= sy && y <= ey) continue;
          const colId = colIds[x]!;
          const rowId = rowIds[y]!;
          let value: string;
          if (isProgression) {
            const stepsAway = seedWidth === 1 ? y - sy : x - sx;
            value = String(first + step * stepsAway);
          } else {
            const localX = ((x - sx) % seedWidth + seedWidth) % seedWidth;
            const localY = ((y - sy) % seedHeight + seedHeight) % seedHeight;
            value = readSeed(localX, localY);
          }
          const id = encodeCellId(colId, rowId);
          if (value === "") {
            cells.delete(id);
            continue;
          }
          const existing = cells.get(id);
          if (existing == null) {
            cells.set(id, new LiveObject({ value }));
          } else {
            existing.set("value", value);
          }
        }
      }
    },
    [],
  );
}

// ── Named ranges ────────────────────────────────────────────────────────────

export function useAddNamedRange() {
  return useMutation(
    (
      { storage },
      name: string,
      sheetId: string,
      startRef: string,
      endRef: string,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      workbook.get("namedRanges").set(name, { sheetId, startRef, endRef });
    },
    [],
  );
}

export function useDeleteNamedRange() {
  return useMutation(({ storage }, name: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    workbook.get("namedRanges").delete(name);
  }, []);
}

/**
 * Remove duplicate rows in the selected range. The first occurrence of each
 * unique key wins; later duplicates are cleared (cells deleted). "Key" =
 * the concatenation of the cell values across `keyColumnIndexes` within the
 * selection. Defaults to all columns in the selection.
 */
export function useRemoveDuplicates() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      bounds: { minX: number; maxX: number; minY: number; maxY: number },
      keyColumnIndexes?: number[],
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const columns = sheet.get("columns");
      const rows = sheet.get("rows");
      const cells = sheet.get("cells");
      const colIds: string[] = [];
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const c = columns.get(x);
        if (c) colIds.push(c.get("id"));
      }
      const seen = new Set<string>();
      const keyCols =
        keyColumnIndexes && keyColumnIndexes.length > 0
          ? keyColumnIndexes.map((i) => i - bounds.minX)
          : colIds.map((_, i) => i);
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        const row = rows.get(y);
        if (!row) continue;
        const rowId = row.get("id");
        const key = keyCols
          .map((i) => {
            const col = colIds[i];
            if (!col) return "";
            return cells.get(`${col}@${rowId}`)?.get("value") ?? "";
          })
          .join("|");
        if (seen.has(key) && key !== "") {
          // Clear every cell in the duplicate row (within the selection).
          for (const c of colIds) cells.delete(`${c}@${rowId}`);
        } else {
          seen.add(key);
        }
      }
    },
    [],
  );
}

// ── Conditional formatting ─────────────────────────────────────────────────

import type {
  ChartType,
  ConditionalRule,
  DataValidationRule,
} from "@/liveblocks.config";

/** Lazy-initializer for the per-sheet LiveMaps added in Phase 4. */
function ensureConditionalRules(
  sheet: ReturnType<typeof findSheet>,
): LiveMap<string, ConditionalRule> | null {
  if (!sheet) return null;
  let m = sheet.get("conditionalRules");
  if (!m) {
    m = new LiveMap<string, ConditionalRule>();
    sheet.set("conditionalRules", m);
  }
  return m;
}
function ensureValidations(
  sheet: ReturnType<typeof findSheet>,
): LiveMap<string, DataValidationRule> | null {
  if (!sheet) return null;
  let m = sheet.get("validations");
  if (!m) {
    m = new LiveMap<string, DataValidationRule>();
    sheet.set("validations", m);
  }
  return m;
}

export function useAddConditionalRule() {
  return useMutation(
    ({ storage }, sheetId: string, rule: ConditionalRule) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      const rules = ensureConditionalRules(sheet);
      if (!rules) return;
      rules.set(rule.id, rule);
    },
    [],
  );
}

export function useDeleteConditionalRule() {
  return useMutation(({ storage }, sheetId: string, ruleId: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const sheet = findSheet(workbook, sheetId);
    if (!sheet) return;
    sheet.get("conditionalRules")?.delete(ruleId);
  }, []);
}

// ── Data validation ────────────────────────────────────────────────────────

export function useSetValidation() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      cellIds: ReadonlyArray<string>,
      rule: DataValidationRule | null,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      const v = ensureValidations(sheet);
      if (!v) return;
      for (const id of cellIds) {
        if (rule == null) v.delete(id);
        else v.set(id, rule);
      }
    },
    [],
  );
}

// ── Sheet protection + group/ungroup ───────────────────────────────────────

export function useToggleProtectSheet() {
  return useMutation(({ storage }, sheetId: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const sheet = findSheet(workbook, sheetId);
    if (!sheet) return;
    sheet.set("protected", !sheet.get("protected"));
  }, []);
}

export function useSetGroupLevel() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      axis: "row" | "col",
      itemId: string,
      level: number,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const sheet = findSheet(workbook, sheetId);
      if (!sheet) return;
      const key = axis === "row" ? "groupLevelsRow" : "groupLevelsCol";
      let m = sheet.get(key);
      if (!m) {
        m = new LiveMap<string, number>();
        sheet.set(key, m);
      }
      if (level <= 0) m.delete(itemId);
      else m.set(itemId, level);
    },
    [],
  );
}

// ── Charts ─────────────────────────────────────────────────────────────────

export function useAddChart() {
  return useMutation(
    (
      { storage },
      sheetId: string,
      type: ChartType,
      startRef: string,
      endRef: string,
      position: { x: number; y: number; width: number; height: number },
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      workbook.get("charts").push(
        new LiveObject({
          id: nanoid(ID_LENGTH),
          sheetId,
          type,
          startRef,
          endRef,
          title: "",
          x: position.x,
          y: position.y,
          width: position.width,
          height: position.height,
          firstRowIsHeader: true,
          firstColumnIsHeader: true,
        }),
      );
    },
    [],
  );
}

export function useDeleteChart() {
  return useMutation(({ storage }, chartId: string) => {
    const workbook = storage.get("workbook");
    if (!workbook) return;
    const charts = workbook.get("charts");
    for (let i = 0; i < charts.length; i++) {
      if (charts.get(i)?.get("id") === chartId) {
        charts.delete(i);
        return;
      }
    }
  }, []);
}

export function useUpdateChart() {
  return useMutation(
    (
      { storage },
      chartId: string,
      patch: Partial<{
        type: ChartType;
        startRef: string;
        endRef: string;
        title: string;
        x: number;
        y: number;
        width: number;
        height: number;
        firstRowIsHeader: boolean;
        firstColumnIsHeader: boolean;
      }>,
    ) => {
      const workbook = storage.get("workbook");
      if (!workbook) return;
      const charts = workbook.get("charts");
      for (let i = 0; i < charts.length; i++) {
        const c = charts.get(i);
        if (c?.get("id") === chartId) {
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) continue;
            (c as unknown as { set: (k: string, v: unknown) => void }).set(k, v);
          }
          return;
        }
      }
    },
    [],
  );
}

// Touch unused type alias so unused-import warnings stay clean.
void (null as unknown as SheetEntry);
