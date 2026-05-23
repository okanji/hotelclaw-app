import { LiveList, LiveMap, LiveObject } from "@liveblocks/client";
import { nanoid } from "nanoid";
import type { CellFormat } from "@/liveblocks.config";
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
 * Build a brand-new workbook tree for `<RoomProvider initialStorage={...}>`.
 * Liveblocks only applies this once per room (first connect with empty
 * storage) — subsequent loads receive the live workbook.
 *
 * Seed cell values may include formulas authored in A1 notation (`=A2*3`).
 * We rewrite each `CellToken` to the resolved `colId@rowId` cell id BEFORE
 * writing to Storage so future column/row reorders don't break references.
 * Runtime-typed formulas get the same treatment via `setCellValue` in
 * `mutations.ts`.
 */
export function createInitialWorkbook(
  seed: ReadonlyArray<ReadonlyArray<string>> = [],
) {
  const firstSheet = buildSheet({ title: "Sheet 1", seed });
  const firstSheetId = firstSheet.get("id");

  return {
    workbook: new LiveObject({
      activeSheetId: firstSheetId,
      sheets: new LiveList([firstSheet]),
      namedRanges: new LiveMap<
        string,
        { sheetId: string; startRef: string; endRef: string }
      >(),
      charts: new LiveList<
        LiveObject<{
          id: string;
          sheetId: string;
          type:
            | "line"
            | "bar"
            | "column"
            | "area"
            | "pie"
            | "scatter";
          startRef: string;
          endRef: string;
          title: string;
          x: number;
          y: number;
          width: number;
          height: number;
          firstRowIsHeader?: boolean;
          firstColumnIsHeader?: boolean;
        }>
      >([]),
    }),
  };
}

/**
 * @deprecated Kept until all consumers move to `createInitialWorkbook`.
 * `<SheetEditor>` still calls this name — alias it for the moment.
 */
export const createInitialSpreadsheet = createInitialWorkbook;

/**
 * Construct a single sheet LiveObject (used by initial seed AND by the
 * `useAddSheet` mutation). Each sheet owns its own cells/columns/rows.
 */
export function buildSheet({
  title,
  seed = [],
  color,
}: {
  title: string;
  seed?: ReadonlyArray<ReadonlyArray<string>>;
  color?: string;
}) {
  const columns: LiveObject<{ id: string; width: number; hidden?: boolean }>[] = [];
  const rows: LiveObject<{ id: string; height: number; hidden?: boolean }>[] = [];
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

  const cells = new LiveMap<
    string,
    LiveObject<{ value: string; format?: CellFormat }>
  >();
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
      cells.set(encodeCellId(colId, rowId), new LiveObject({ value }));
    }
  }

  return new LiveObject({
    id: nanoid(ID_LENGTH),
    title,
    color,
    cells,
    columns: new LiveList(columns),
    rows: new LiveList(rows),
    merges: new LiveMap<string, string>(),
    frozenRows: 0,
    frozenColumns: 0,
  });
}

/**
 * Rewrites A1 cell references inside a formula body to `colId@rowId` cell
 * ids, given the column/row ID arrays for the sheet. Non-formula values
 * pass through unchanged. Out-of-bounds refs are left as-is; the evaluator
 * surfaces the resulting error at render time.
 *
 * Cross-sheet refs (`Sheet2!A1`) get the `Sheet2!` prefix preserved verbatim
 * and the A1 portion rewritten to the destination sheet's column/row ids —
 * but since this function only knows about the active sheet's ids, the
 * caller is responsible for passing the right sheet's ids when rewriting
 * cross-sheet portions. For now, cross-sheet ref rewriting happens in
 * `mutations.ts` via `rewriteRefsForWorkbook`, which knows the workbook.
 */
export function rewriteA1Refs(
  expression: string,
  columnIds: string[],
  rowIds: string[],
): string {
  if (!expression.startsWith("=")) return expression;
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
 * The inverse — `colId@rowId` ids → `A1`, for displaying a stored formula
 * back in A1 notation while the user edits it. Returns the original string
 * if any embedded ref can't be located (column or row was deleted since).
 */
export function unwriteRefsToA1(
  storedFormula: string,
  columnIds: string[],
  rowIds: string[],
): string {
  if (!storedFormula.startsWith("=")) return storedFormula;
  return storedFormula.replace(
    /([A-Za-z0-9_-]+)@([A-Za-z0-9_-]+)/g,
    (match, c, r) => {
      const colIdx = columnIds.indexOf(c);
      const rowIdx = rowIds.indexOf(r);
      if (colIdx < 0 || rowIdx < 0) return match;
      return `${indexToColumnLetter(colIdx)}${rowIdx + 1}`;
    },
  );
}

function indexToColumnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
