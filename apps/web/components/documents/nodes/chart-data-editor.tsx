"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartData } from "@/lib/documents/nodes/chart";

/** Non-empty text that won't parse as a number — charts as 0, so warn. */
function isInvalidNumber(value: string) {
  return value.trim() !== "" && !Number.isFinite(Number(value));
}

/**
 * Inline grid editor for the Chart node's data. Pure controlled component:
 * the parent passes `data` and an `onChange`; we don't store anything
 * internally. All edits flow through editor.commands.updateAttributes
 * via the parent's `onChange` so Yjs sync gets every keystroke.
 */
export function ChartDataEditor({
  data,
  onChange,
}: {
  data: ChartData;
  onChange: (next: ChartData) => void;
}) {
  function setHeader(index: number, value: string) {
    const headers = [...data.headers];
    headers[index] = value;
    onChange({ ...data, headers });
  }

  function setCell(rowIndex: number, colIndex: number, value: string) {
    const rows = data.rows.map((row, ri) => {
      if (ri !== rowIndex) return row;
      const next = [...row];
      next[colIndex] = value;
      return next;
    });
    onChange({ ...data, rows });
  }

  function addRow() {
    onChange({
      ...data,
      rows: [
        ...data.rows,
        Array.from({ length: data.headers.length }, (_, i) =>
          i === 0 ? "" : "0",
        ),
      ],
    });
  }

  function removeRow(rowIndex: number) {
    if (data.rows.length <= 1) return;
    onChange({ ...data, rows: data.rows.filter((_, i) => i !== rowIndex) });
  }

  function addColumn() {
    onChange({
      headers: [...data.headers, `Series ${data.headers.length}`],
      rows: data.rows.map((r) => [...r, "0"]),
    });
  }

  function removeColumn(colIndex: number) {
    // Always keep at least 2 columns: the X label + one series.
    if (data.headers.length <= 2 || colIndex === 0) return;
    onChange({
      headers: data.headers.filter((_, i) => i !== colIndex),
      rows: data.rows.map((r) => r.filter((_, i) => i !== colIndex)),
    });
  }

  return (
    <div className="overflow-x-auto rounded-md bg-muted">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-muted">
            {data.headers.map((h, i) => (
              <th
                key={i}
                className="border-b border-border px-1.5 py-1 text-left font-medium"
              >
                <div className="flex items-center gap-1">
                  <input
                    value={h}
                    aria-label={`Column ${i + 1} name`}
                    onChange={(e) => setHeader(i, e.target.value)}
                    className="w-full min-w-[6ch] rounded-[4px] bg-transparent px-1 text-xs font-medium outline-none focus-visible:bg-background focus-visible:shadow-focus"
                  />
                  {i > 0 && data.headers.length > 2 ? (
                    <button
                      type="button"
                      onClick={() => removeColumn(i)}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Remove column"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </div>
              </th>
            ))}
            <th className="w-8 border-b border-border bg-muted px-1">
              <button
                type="button"
                onClick={addColumn}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Add column"
              >
                <Plus className="size-3.5" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-accent">
              {row.map((cell, ci) => {
                // Column 0 is the X-axis label; everything after is numeric.
                const numeric = ci > 0;
                const invalid = numeric && isInvalidNumber(cell);
                return (
                  <td
                    key={ci}
                    className="border-b border-border px-1.5 py-1"
                  >
                    <input
                      value={cell}
                      inputMode={numeric ? "decimal" : undefined}
                      aria-label={`Row ${ri + 1}, ${data.headers[ci] || `column ${ci + 1}`}`}
                      aria-invalid={invalid || undefined}
                      title={
                        invalid
                          ? "Not a number — will chart as 0"
                          : undefined
                      }
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      onKeyDown={
                        numeric
                          ? (e) => {
                              if (
                                e.key !== "ArrowUp" &&
                                e.key !== "ArrowDown"
                              )
                                return;
                              e.preventDefault();
                              const parsed = Number(cell);
                              const base = Number.isFinite(parsed)
                                ? parsed
                                : 0;
                              const delta =
                                (e.key === "ArrowUp" ? 1 : -1) *
                                (e.shiftKey ? 10 : 1);
                              setCell(ri, ci, String(base + delta));
                            }
                          : undefined
                      }
                      className={cn(
                        "w-full rounded-[4px] bg-transparent px-1 text-xs outline-none focus-visible:bg-background focus-visible:shadow-focus",
                        numeric && "tabular-nums",
                        invalid && "text-destructive",
                      )}
                    />
                  </td>
                );
              })}
              <td className="border-b border-border px-1 text-center">
                <button
                  type="button"
                  onClick={() => removeRow(ri)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Remove row"
                  disabled={data.rows.length <= 1}
                >
                  <Trash2 className="size-3" />
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={data.headers.length + 1} className="px-1.5 py-1">
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Plus className="size-3.5" /> Add row
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
