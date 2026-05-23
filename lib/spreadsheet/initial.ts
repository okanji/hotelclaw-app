import { LiveList, LiveMap, LiveObject } from "@liveblocks/client";
import { nanoid } from "nanoid";
import { encodeCellId } from "./cell-id";
import {
  COLUMN_DEFAULT_WIDTH,
  ID_LENGTH,
  INITIAL_COLUMNS,
  INITIAL_ROWS,
  ROW_DEFAULT_HEIGHT,
} from "./constants";
import { letterToNumber } from "./formula/utils";

/**
 * Build the `initialStorage` passed to `RoomProvider` for a brand-new sheet.
 * Liveblocks only applies this once per room (on first connect with empty
 * storage) — subsequent loads receive the live tree.
 *
 * Seed cell values may include formulas authored in A1 notation (`=A2*3`).
 * We rewrite each `CellToken` to the resolved `colId:rowId` BEFORE writing
 * to Storage so future column/row reorders don't break the references. New
 * formulas typed at runtime get the same treatment via `setCellValue` in
 * mutations.ts.
 */
export function createInitialSpreadsheet(
  seed: ReadonlyArray<ReadonlyArray<string>> = [],
) {
  const columns: LiveObject<{ id: string; width: number }>[] = [];
  const rows: LiveObject<{ id: string; height: number }>[] = [];
  for (let i = 0; i < INITIAL_COLUMNS; i++) {
    columns.push(
      new LiveObject({ id: nanoid(ID_LENGTH), width: COLUMN_DEFAULT_WIDTH }),
    );
  }
  for (let i = 0; i < INITIAL_ROWS; i++) {
    rows.push(
      new LiveObject({ id: nanoid(ID_LENGTH), height: ROW_DEFAULT_HEIGHT }),
    );
  }
  const columnIds = columns.map((c) => c.get("id"));
  const rowIds = rows.map((r) => r.get("id"));

  const cells = new LiveMap<string, LiveObject<{ value: string }>>();
  for (let y = 0; y < seed.length; y++) {
    const row = seed[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const raw = row[x];
      if (raw == null || raw === "") continue;
      const colId = columnIds[x];
      const rowId = rowIds[y];
      if (!colId || !rowId) continue;
      const value = rewriteA1Refs(raw, columnIds, rowIds);
      cells.set(
        encodeCellId(colId, rowId),
        new LiveObject({ value }),
      );
    }
  }

  return {
    spreadsheet: new LiveObject({
      cells,
      columns: new LiveList(columns),
      rows: new LiveList(rows),
    }),
  };
}

/**
 * Rewrites A1 cell references inside a formula body to `colId:rowId` cell
 * ids, given the column/row ID arrays for the sheet. Non-formula values pass
 * through unchanged. Throws nothing — out-of-bounds refs are left as-is and
 * the evaluator surfaces the error at render time.
 */
export function rewriteA1Refs(
  expression: string,
  columnIds: string[],
  rowIds: string[],
): string {
  if (!expression.startsWith("=")) return expression;
  // Match the A1 portion only when it isn't preceded/followed by another
  // identifier character — a 1-char lookahead is enough since we don't have
  // identifiers in this grammar.
  return expression.replace(/\b([A-Z]+)([0-9]+)\b/g, (match, letter, num) => {
    const colIdx = letterToNumber(letter) - 1;
    const rowIdx = Number.parseInt(num, 10) - 1;
    const colId = columnIds[colIdx];
    const rowId = rowIds[rowIdx];
    if (!colId || !rowId) return match;
    return `${colId}@${rowId}`;
  });
}

/**
 * The inverse — `colId:rowId` ids → `A1`, for displaying a stored formula
 * back in A1 notation while the user edits it. Returns the original string
 * if any embedded ref can't be located (column or row was deleted since).
 */
export function unwriteRefsToA1(
  storedFormula: string,
  columnIds: string[],
  rowIds: string[],
): string {
  if (!storedFormula.startsWith("=")) return storedFormula;
  return storedFormula.replace(/([A-Za-z0-9_-]+)@([A-Za-z0-9_-]+)/g, (match, c, r) => {
    const colIdx = columnIds.indexOf(c);
    const rowIdx = rowIds.indexOf(r);
    if (colIdx < 0 || rowIdx < 0) return match;
    // Inverse of `letterToNumber`.
    return `${indexToColumnLetter(colIdx)}${rowIdx + 1}`;
  });
}

function indexToColumnLetter(index: number): string {
  // Local mirror of `numberToLetter(index + 1)` to keep this module
  // independent of `formula/utils` for tree-shaking.
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
