"use client";

/**
 * A single cell. Two render modes — display (default) and edit (when the
 * user double-clicks or presses Enter on the selected cell).
 *
 * Display reads the **evaluated** value from `cellGraph` and applies the
 * cell's format (bold/italic/color/number-format/alignment). Edit mode is
 * a plain text input populated with the **stored** value rewritten to A1
 * notation so the user sees `=A2*3` instead of `=col-id@row-id*3`.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { CellFormat } from "@/liveblocks.config";
import type { ExpressionResult } from "@/lib/spreadsheet/formula";

export type CellOther = { color: string; name: string };

export type SheetCellProps = {
  columnId: string;
  rowId: string;
  rawValue: string;
  displayFormula: string;
  evaluated: ExpressionResult;
  format?: CellFormat;
  isSelected: boolean;
  isInRange: boolean;
  isEditing: boolean;
  /** Cell is highlighted by an active find/replace match. */
  isMatch?: boolean;
  /** Cell is the active find match (the one currently focused). */
  isActiveMatch?: boolean;
  /** This is the bottom-right cell of the selection rectangle (for AutoFill). */
  isFillCorner?: boolean;
  /** Another user's selection on this cell. */
  other?: CellOther;
  editSeed?: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onCommit: (
    value: string,
    advance: "down" | "right" | "up" | "left" | null,
  ) => void;
  onCancel: () => void;
  onFillStart?: (e: React.MouseEvent) => void;
};

export function SheetCell({
  rawValue: _rawValue,
  displayFormula,
  evaluated,
  format,
  isSelected,
  isInRange,
  isEditing,
  isMatch,
  isActiveMatch,
  isFillCorner,
  other,
  editSeed,
  onMouseDown,
  onMouseEnter,
  onDoubleClick,
  onCommit,
  onCancel,
  onFillStart,
}: SheetCellProps) {
  const display = useMemo(
    () => renderEvaluated(evaluated, format),
    [evaluated, format],
  );

  const style: CSSProperties = {};
  if (other) (style as Record<string, string>)["--hc-other-color"] = other.color;
  if (format?.bold) style.fontWeight = 700;
  if (format?.italic) style.fontStyle = "italic";
  if (format?.textColor) style.color = format.textColor;
  if (format?.bgColor) style.background = format.bgColor;
  const textDecoration = [
    format?.underline ? "underline" : null,
    format?.strike ? "line-through" : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (textDecoration) style.textDecoration = textDecoration;

  const align = format?.align ?? (evaluated.type === "number" ? "right" : "left");

  return (
    <td
      className="hc-sheet-cell"
      data-type={evaluated.type}
      data-selected={isSelected ? "true" : undefined}
      data-in-range={isInRange ? "true" : undefined}
      data-other-color={other ? "true" : undefined}
      data-match={isMatch ? "true" : undefined}
      data-active-match={isActiveMatch ? "true" : undefined}
      style={style}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
    >
      {isEditing ? (
        <CellInput
          initial={editSeed != null ? editSeed : displayFormula}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ) : (
        <span
          className="hc-sheet-cell-text"
          style={{ textAlign: align }}
        >
          {display}
        </span>
      )}
      {other && !isEditing ? (
        <span className="hc-sheet-other-pill">{other.name}</span>
      ) : null}
      {isFillCorner && !isEditing ? (
        <span
          className="hc-sheet-fill-handle"
          onMouseDown={(e) => {
            // Prevent the cell's onMouseDown from claiming this — fill drag
            // starts here, not a selection re-anchor.
            e.stopPropagation();
            onFillStart?.(e);
          }}
        />
      ) : null}
    </td>
  );
}

function CellInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (
    value: string,
    advance: "down" | "right" | "up" | "left" | null,
  ) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  return (
    <input
      ref={ref}
      className="hc-sheet-cell-input"
      defaultValue={initial}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(e.currentTarget.value, e.shiftKey ? "up" : "down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          onCommit(e.currentTarget.value, e.shiftKey ? "left" : "right");
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value, null)}
    />
  );
}

/**
 * Render an evaluated cell value as display text, applying the cell's
 * format. Number formats use `Intl.NumberFormat` / `Intl.DateTimeFormat`.
 * Strings ignore numeric format (they're not numbers).
 */
function renderEvaluated(r: ExpressionResult, format?: CellFormat): string {
  if (r.type === "error") return "#ERR";
  if (r.type === "boolean") return r.value ? "TRUE" : "FALSE";
  if (r.type === "string") return r.value;
  // r.type === "number"
  const value = r.value;
  if (!Number.isFinite(value)) return "#ERR";
  const nf = format?.numberFormat ?? "plain";
  const decimals = format?.decimals;
  switch (nf) {
    case "currency":
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: decimals ?? 2,
        minimumFractionDigits: decimals ?? 2,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: decimals ?? 2,
        minimumFractionDigits: decimals ?? 0,
      }).format(value);
    case "number":
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: decimals ?? 2,
        minimumFractionDigits: decimals ?? 0,
      }).format(value);
    case "date":
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
      }).format(toDate(value));
    case "datetime":
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(toDate(value));
    case "plain":
    default: {
      // Strip JS's noisy `.0000000001` artifacts at 10 sig figs.
      const rounded = Math.round(value * 1e10) / 1e10;
      return String(rounded);
    }
  }
}

/**
 * Convert a numeric cell value to a Date. We accept two encodings:
 *   1. Unix epoch milliseconds (large integer)
 *   2. Excel serial date (days since 1899-12-30) — under ~60000 = pre-2065.
 *      Useful when the user types something like `45000` and formats it as
 *      a date.
 */
function toDate(value: number): Date {
  if (value > 1e10) return new Date(value); // epoch ms
  // Excel serial date
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + value * 86400000);
}
