"use client";

/**
 * CSV + Excel import/export. Uses SheetJS (`xlsx`) which handles .xlsx,
 * .csv, .ods, .tsv. We do all the row/column transformation against the
 * workbook snapshot — no Liveblocks interaction here; export is a pure
 * function of the current Storage tree, import generates seed data for the
 * surface to push back via mutations.
 */

import * as XLSX from "xlsx";

export type ExportRows = string[][];

/** Build a 2D string matrix for a single sheet, ready for SheetJS. */
export function sheetToMatrix(
  columnIds: string[],
  rowIds: string[],
  cellsByKey: Map<string, string>,
): ExportRows {
  const out: ExportRows = [];
  for (const rowId of rowIds) {
    const row: string[] = [];
    let lastNonEmpty = -1;
    for (let x = 0; x < columnIds.length; x++) {
      const colId = columnIds[x]!;
      const v = cellsByKey.get(`${colId}@${rowId}`) ?? "";
      // Strip the colId@rowId-form refs in stored formulas — they're noise
      // to anyone opening the file in Excel.
      const clean = v.startsWith("=")
        ? v.replace(/[A-Za-z0-9_-]+@[A-Za-z0-9_-]+/g, "(ref)")
        : v;
      row.push(clean);
      if (clean !== "") lastNonEmpty = x;
    }
    // Trim trailing empties.
    row.length = Math.max(0, lastNonEmpty + 1);
    out.push(row);
  }
  // Trim trailing empty rows.
  while (out.length > 0 && out[out.length - 1]!.length === 0) out.pop();
  return out;
}

/** Trigger a browser download of `data` as `filename`. */
function downloadBlob(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(matrix: ExportRows, filename: string) {
  const csv = matrix
    .map((row) =>
      row
        .map((cell) => {
          // RFC 4180 quoting — escape quotes by doubling, wrap if contains
          // comma/quote/newline.
          if (/[",\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
          return cell;
        })
        .join(","),
    )
    .join("\n");
  downloadBlob(csv, filename, "text/csv;charset=utf-8");
}

export function exportTsv(matrix: ExportRows, filename: string) {
  const tsv = matrix
    .map((row) => row.map((c) => c.replace(/[\t\n\r]+/g, " ")).join("\t"))
    .join("\n");
  downloadBlob(tsv, filename, "text/tab-separated-values;charset=utf-8");
}

export type WorkbookExport = {
  filename: string;
  sheets: Array<{ title: string; matrix: ExportRows }>;
};

export function exportXlsx(workbook: WorkbookExport) {
  const wb = XLSX.utils.book_new();
  for (const { title, matrix } of workbook.sheets) {
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    // Excel allows max 31 chars in a sheet name; truncate cleanly.
    const safeTitle = title.slice(0, 31).replace(/[\\/?*[\]]/g, "");
    XLSX.utils.book_append_sheet(wb, ws, safeTitle || "Sheet");
  }
  XLSX.writeFile(wb, workbook.filename);
}

export type ImportedSheet = {
  title: string;
  /** Row-major matrix. Cells are strings (numbers/dates are stringified). */
  matrix: ExportRows;
};

/** Parse a File (CSV / TSV / XLSX) into one or more sheets. */
export async function importSpreadsheetFile(file: File): Promise<ImportedSheet[]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "tsv") {
    const text = await file.text();
    const sep = ext === "tsv" ? "\t" : ",";
    return [
      {
        title: file.name.replace(/\.(csv|tsv)$/i, "") || "Imported",
        matrix: parseDelimited(text, sep),
      },
    ];
  }
  // Excel / ODS / numbers — delegate to SheetJS.
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const out: ImportedSheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]!;
    const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as ExportRows;
    out.push({ title: name, matrix });
  }
  return out;
}

/**
 * Minimal CSV parser with RFC 4180-ish quoting. Good enough for the export
 * format above + Excel's CSV-from-spreadsheet output. Doesn't try to handle
 * exotic edge cases (mixed quote escapes, BOMs in mid-stream).
 */
function parseDelimited(text: string, sep: string): ExportRows {
  const rows: ExportRows = [];
  let i = 0;
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  // Strip leading BOM.
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === sep) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      cell = "";
      row = [];
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
