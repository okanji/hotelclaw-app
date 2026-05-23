/**
 * `cellId` is the LiveMap key for a single cell — a stable, reorder-safe
 * identifier built from the column id and the row id.
 *
 * We use `@` as the delimiter because:
 *   1. nanoid's default alphabet (A–Za–z0–9_-) does NOT include `@`, so a
 *      ref pattern `[A-Za-z0-9_-]+@[A-Za-z0-9_-]+` is unambiguous.
 *   2. The `:` character is reserved for ranges in stored formulas: a
 *      range like `A1:B5` stores as `<colA>@<row1>:<colB>@<row5>` — the
 *      tokenizer can split refs from ranges without guessing.
 *
 * Upstream concatenated `${colId}${rowId}` and split on the midpoint, which
 * only works when both IDs are the same length — fragile and dropped here.
 */

const DELIMITER = "@";

export function encodeCellId(columnId: string, rowId: string): string {
  if (columnId.includes(DELIMITER) || rowId.includes(DELIMITER)) {
    throw new Error(
      `cell id components must not contain "${DELIMITER}": got "${columnId}", "${rowId}"`,
    );
  }
  return `${columnId}${DELIMITER}${rowId}`;
}

export function decodeCellId(
  cellId: string,
): { columnId: string; rowId: string } | null {
  const i = cellId.indexOf(DELIMITER);
  if (i <= 0 || i === cellId.length - 1) return null;
  return {
    columnId: cellId.slice(0, i),
    rowId: cellId.slice(i + 1),
  };
}

/** Regex matching a single cell ref token in the stored formula form. */
export const REF_RE = /[A-Za-z0-9_-]+@[A-Za-z0-9_-]+/g;
