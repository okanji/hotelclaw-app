/**
 * Helpers shared by the formula engine and the spreadsheet UI.
 */

/** Returns true if a raw string looks numeric (decimal, optional sign). */
export function isNumerical(input: string): boolean {
  if (input.length === 0) return false;
  // `Number.parseFloat("12px")` returns 12 — too lenient. Require the whole
  // string to be a JS number.
  const n = Number(input);
  return !Number.isNaN(n) && Number.isFinite(n);
}

/**
 * `A` ↔ `1`, `Z` ↔ `26`, `AA` ↔ `27`. Base-26-with-no-zero, like spreadsheet
 * column headers. Index is **1-based** in the formula language (matching A1)
 * but **0-based** when interfacing with array positions — callers offset by
 * 1 as needed.
 */
export function letterToNumber(letter: string): number {
  let n = 0;
  for (let i = 0; i < letter.length; i++) {
    n = n * 26 + (letter.charCodeAt(i) - 64);
  }
  return n;
}

export function numberToLetter(n: number): string {
  let out = "";
  let v = n;
  while (v > 0) {
    const rem = (v - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
}

/** Column header label for a 0-based column index. `0 → 'A'`. */
export function getColumnLabel(index: number): string {
  return numberToLetter(index + 1);
}

/** Row header label for a 0-based row index. `0 → '1'`. */
export function getRowLabel(index: number): string {
  return String(index + 1);
}

/** Render an evaluator result for display. */
export function formatExpressionResult(value: number): string {
  if (!Number.isFinite(value)) return "#ERR";
  // Strip the trailing `.0` JS adds to ints; cap noisy floats at 10 sig figs.
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}
