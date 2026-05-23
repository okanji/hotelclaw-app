"use client";

/**
 * Storage mutation hooks for the spreadsheet.
 *
 * Each operation is a `useMutation` callback — Liveblocks' modern React API.
 * Inside a useMutation body the storage proxy is always in batch mode, so
 * complex changes (e.g. deleteColumn wiping every cell in that column)
 * commit as a single op + undo entry.
 *
 * Read/seed your column and row IDs from the LiveLists before constructing
 * new cell ids — there is no "by index" cell lookup, only `colId:rowId`.
 */

import { LiveObject } from "@liveblocks/client";
import { useMutation } from "@liveblocks/react";
import { nanoid } from "nanoid";
import type { CellFormat } from "@/liveblocks.config";
import { encodeCellId } from "./cell-id";
import {
  COLUMN_DEFAULT_WIDTH,
  ID_LENGTH,
  ROW_DEFAULT_HEIGHT,
} from "./constants";
import { rewriteA1Refs } from "./initial";

/** Insert a new column at `index`. Default width unless overridden. */
export function useInsertColumn() {
  return useMutation(
    (
      { storage },
      index: number,
      width: number = COLUMN_DEFAULT_WIDTH,
    ) => {
      const sheet = storage.get("spreadsheet");
      if (!sheet) return;
      sheet
        .get("columns")
        .insert(new LiveObject({ id: nanoid(ID_LENGTH), width }), index);
    },
    [],
  );
}

/** Insert a new row at `index`. */
export function useInsertRow() {
  return useMutation(
    (
      { storage },
      index: number,
      height: number = ROW_DEFAULT_HEIGHT,
    ) => {
      const sheet = storage.get("spreadsheet");
      if (!sheet) return;
      sheet
        .get("rows")
        .insert(new LiveObject({ id: nanoid(ID_LENGTH), height }), index);
    },
    [],
  );
}

/**
 * Delete a column. Walks the row list and removes every cell in that
 * column from the cells map. Single batch — undo restores both the column
 * and the cells.
 */
export function useDeleteColumn() {
  return useMutation(({ storage }, index: number) => {
    const sheet = storage.get("spreadsheet");
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

/** Delete a row, with the same cell-cleanup pattern. */
export function useDeleteRow() {
  return useMutation(({ storage }, index: number) => {
    const sheet = storage.get("spreadsheet");
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

/** Reorder a column from `from` to `to`. */
export function useMoveColumn() {
  return useMutation(({ storage }, from: number, to: number) => {
    const sheet = storage.get("spreadsheet");
    if (!sheet) return;
    sheet.get("columns").move(from, to);
  }, []);
}

/** Reorder a row from `from` to `to`. */
export function useMoveRow() {
  return useMutation(({ storage }, from: number, to: number) => {
    const sheet = storage.get("spreadsheet");
    if (!sheet) return;
    sheet.get("rows").move(from, to);
  }, []);
}

/** Resize a column. Caller is responsible for clamping to min/max. */
export function useResizeColumn() {
  return useMutation(({ storage }, index: number, width: number) => {
    const sheet = storage.get("spreadsheet");
    if (!sheet) return;
    const col = sheet.get("columns").get(index);
    if (!col) return;
    col.set("width", width);
  }, []);
}

/** Resize a row. */
export function useResizeRow() {
  return useMutation(({ storage }, index: number, height: number) => {
    const sheet = storage.get("spreadsheet");
    if (!sheet) return;
    const row = sheet.get("rows").get(index);
    if (!row) return;
    row.set("height", height);
  }, []);
}

/**
 * Write a single cell. Rewrites any A1 refs in the input to `colId:rowId`
 * BEFORE storage so reorders stay safe. Empty string clears the cell.
 */
export function useSetCellValue() {
  return useMutation(
    ({ storage }, columnId: string, rowId: string, rawInput: string) => {
      const sheet = storage.get("spreadsheet");
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

/**
 * Bulk paste: write a 2D matrix of raw values starting at the given
 * top-left cell. Cells outside the sheet's bounds are dropped silently;
 * we don't auto-grow. Single batch so paste is one undo entry.
 */
export function usePasteRange() {
  return useMutation(
    (
      { storage },
      topLeft: { columnId: string; rowId: string },
      matrix: ReadonlyArray<ReadonlyArray<string>>,
    ) => {
      const sheet = storage.get("spreadsheet");
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
        if (!rowId) break; // ran off bottom
        for (let dx = 0; dx < row.length; dx++) {
          const x = startX + dx;
          const colId = colIds[x];
          if (!colId) break; // ran off right
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

/**
 * Clear every cell in a list of (columnId, rowId) addresses. Used by
 * Delete/Backspace on a range. Single batch.
 */
export function useClearCells() {
  return useMutation(
    (
      { storage },
      addresses: ReadonlyArray<{ columnId: string; rowId: string }>,
    ) => {
      const sheet = storage.get("spreadsheet");
      if (!sheet) return;
      const cells = sheet.get("cells");
      for (const a of addresses) {
        cells.delete(encodeCellId(a.columnId, a.rowId));
      }
    },
    [],
  );
}

/**
 * Patch (merge) the format of every cell in a list of addresses. A cell with
 * no existing format is created with just `{ value: "", format }`. Pass
 * `null` for a key to clear that field. Single batch.
 *
 * Example:
 *   setCellFormat(addresses, { bold: true })          // turn bold on
 *   setCellFormat(addresses, { bold: undefined })     // toggle off
 *   setCellFormat(addresses, { numberFormat: "currency", decimals: 2 })
 */
export function useSetCellFormat() {
  return useMutation(
    (
      { storage },
      addresses: ReadonlyArray<{ columnId: string; rowId: string }>,
      patch: Partial<CellFormat>,
    ) => {
      const sheet = storage.get("spreadsheet");
      if (!sheet) return;
      const cells = sheet.get("cells");
      for (const a of addresses) {
        const id = encodeCellId(a.columnId, a.rowId);
        const cell = cells.get(id);
        if (cell == null) {
          cells.set(id, new LiveObject({ value: "", format: cleanPatch(patch) }));
        } else {
          const current = cell.get("format") ?? {};
          const merged: CellFormat = { ...current, ...patch };
          // Strip explicit undefined so format objects don't accumulate junk.
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

/**
 * Sort a column. Reads every cell value in the column, sorts ascending or
 * descending, and writes back IN-PLACE keyed by row ID. Formulas referring
 * to ids in this column will see their value's cell change — by design
 * (sort moves values, not the cell identity). Single batch.
 *
 * Empty cells sink to the bottom regardless of direction.
 */
export function useSortColumn() {
  return useMutation(
    (
      { storage },
      columnIndex: number,
      direction: "asc" | "desc",
    ) => {
      const sheet = storage.get("spreadsheet");
      if (!sheet) return;
      const columns = sheet.get("columns");
      const rows = sheet.get("rows");
      const cells = sheet.get("cells");
      const col = columns.get(columnIndex);
      if (!col) return;
      const colId = col.get("id");
      const values: Array<{ rowId: string; value: string }> = [];
      const empties: string[] = [];
      for (let y = 0; y < rows.length; y++) {
        const rowId = rows.get(y)!.get("id");
        const id = encodeCellId(colId, rowId);
        const c = cells.get(id);
        const v = c?.get("value") ?? "";
        if (v === "") empties.push(rowId);
        else values.push({ rowId, value: v });
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
      // Write back to rows in their original (row id) order using the sorted
      // values. Empties trail.
      const sortedValues = values.map((v) => v.value);
      for (let y = 0; y < rows.length; y++) {
        const rowId = rows.get(y)!.get("id");
        const newValue =
          y < sortedValues.length ? sortedValues[y]! : "";
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
      void empties;
    },
    [],
  );
}

/**
 * AutoFill — extend `seed` (read at the time of call) across the target
 * rectangle, with simple linear-progression detection for numeric series.
 * Falls back to literal repetition for strings and single-value seeds.
 */
export function useAutoFill() {
  return useMutation(
    (
      { storage },
      seedTopLeft: { columnId: string; rowId: string },
      seedBottomRight: { columnId: string; rowId: string },
      targetTopLeft: { columnId: string; rowId: string },
      targetBottomRight: { columnId: string; rowId: string },
    ) => {
      const sheet = storage.get("spreadsheet");
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

      // Linear progression detection for single-column or single-row seeds.
      const seedValues: string[] = [];
      for (let i = 0; i < Math.max(seedWidth, seedHeight); i++) {
        if (seedWidth === 1) seedValues.push(readSeed(0, i));
        else if (seedHeight === 1) seedValues.push(readSeed(i, 0));
      }
      const isProgression =
        (seedWidth === 1 || seedHeight === 1) &&
        seedValues.length >= 2 &&
        seedValues.every((v) => Number.isFinite(Number(v)));
      const step =
        isProgression
          ? Number(seedValues[1]) - Number(seedValues[0])
          : 0;
      const first = isProgression ? Number(seedValues[0]) : 0;

      for (let y = ty; y <= tey; y++) {
        for (let x = tx; x <= tex; x++) {
          // Skip writing back over the seed itself.
          if (x >= sx && x <= ex && y >= sy && y <= ey) continue;
          const colId = colIds[x]!;
          const rowId = rowIds[y]!;
          let value: string;
          if (isProgression) {
            const stepsAway =
              seedWidth === 1 ? y - sy : x - sx; // distance in fill direction
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
