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
import type {
  CellBorder,
  CellFormat,
  DataValidationRule,
} from "@/liveblocks.config";
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
  /** Cell has at least one unresolved comment thread. Drives the indicator. */
  hasComment?: boolean;
  /** If this cell is the top-left of a merge, span N columns / M rows. */
  colSpan?: number;
  rowSpan?: number;
  /** Data validation rule, if any. Drives checkbox/dropdown render + invalid border. */
  validation?: DataValidationRule;
  /** Another user's selection on this cell. */
  other?: CellOther;
  editSeed?: string;
  /**
   * Sticky positioning offsets when this cell falls inside a freeze pane.
   * `frozenLeft` makes the cell stay visible when scrolling horizontally;
   * `frozenTop` for vertical. `null` = not frozen on that axis.
   */
  frozenLeft?: number | null;
  frozenTop?: number | null;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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
  hasComment,
  colSpan,
  rowSpan,
  validation,
  other,
  editSeed,
  frozenLeft,
  frozenTop,
  onMouseDown,
  onMouseEnter,
  onContextMenu,
  onDoubleClick,
  onCommit,
  onCancel,
  onFillStart,
}: SheetCellProps) {
  const display = useMemo(
    () => renderEvaluated(evaluated, format),
    [evaluated, format],
  );

  /** Validation pass — flags invalid input. */
  const isInvalid = useMemo(() => {
    if (!validation) return false;
    return !validateAgainstRule(validation, evaluated, _rawValue);
  }, [validation, evaluated, _rawValue]);

  const style: CSSProperties = {};
  if (other) (style as Record<string, string>)["--hc-other-color"] = other.color;
  if (format?.bold) style.fontWeight = 700;
  if (format?.italic) style.fontStyle = "italic";
  if (format?.textColor) style.color = format.textColor;
  if (format?.bgColor) style.background = format.bgColor;
  if (format?.fontFamily) style.fontFamily = format.fontFamily;
  if (format?.fontSize) style.fontSize = `${format.fontSize}px`;
  if (format?.borderTop) style.borderTop = borderCss(format.borderTop);
  if (format?.borderRight) style.borderRight = borderCss(format.borderRight);
  if (format?.borderBottom) style.borderBottom = borderCss(format.borderBottom);
  if (format?.borderLeft) style.borderLeft = borderCss(format.borderLeft);
  const textDecoration = [
    format?.underline ? "underline" : null,
    format?.strike ? "line-through" : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (textDecoration) style.textDecoration = textDecoration;

  // Freeze pane positioning. Sticky inside a `<td>` works in modern browsers
  // (Chrome, Safari, Firefox all support it). z-index 2 when frozen on only
  // one axis, 3 when both — so a "stuck" cell rides above its sliding
  // neighbors.
  if (frozenLeft != null && frozenTop != null) {
    style.position = "sticky";
    style.left = frozenLeft;
    style.top = frozenTop;
    style.zIndex = 3;
  } else if (frozenLeft != null) {
    style.position = "sticky";
    style.left = frozenLeft;
    style.zIndex = 2;
  } else if (frozenTop != null) {
    style.position = "sticky";
    style.top = frozenTop;
    style.zIndex = 2;
  }

  const wrap = format?.wrap ?? "overflow";
  const cellWrapClass =
    wrap === "wrap"
      ? "hc-sheet-wrap-wrap"
      : wrap === "clip"
        ? "hc-sheet-wrap-clip"
        : "hc-sheet-wrap-overflow";

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
      data-invalid={isInvalid ? "true" : undefined}
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={style}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      {validation?.kind === "checkbox" && !isEditing ? (
        <input
          type="checkbox"
          checked={_rawValue === "TRUE" || _rawValue === "true" || _rawValue === "1"}
          onChange={(e) => {
            // Commit the boolean directly via the editing API.
            onCommit(e.target.checked ? "TRUE" : "FALSE", null);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="hc-sheet-checkbox"
        />
      ) : isEditing && validation?.kind === "list" ? (
        <select
          autoFocus
          value={_rawValue}
          onChange={(e) => onCommit(e.target.value, "down")}
          onBlur={(e) => onCommit(e.currentTarget.value, null)}
          className="hc-sheet-cell-input"
        >
          <option value=""></option>
          {validation.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : isEditing ? (
        <CellInput
          initial={editSeed != null ? editSeed : displayFormula}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ) : isSparkline(display) ? (
        <Sparkline encoded={display} />
      ) : format?.link ? (
        <a
          className={`hc-sheet-cell-text ${cellWrapClass}`}
          style={{ textAlign: align }}
          href={format.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {display}
        </a>
      ) : (
        <span
          className={`hc-sheet-cell-text ${cellWrapClass}`}
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
      {hasComment ? (
        <span
          className="hc-sheet-comment-indicator"
          aria-label="Has comment"
          title="Has comment — open the comments sidebar to read"
        />
      ) : null}
    </td>
  );
}

/**
 * Sparkline rendering — encoded as `__SPARKLINE__:type:nums:color` by the
 * `=SPARKLINE()` function. Renders inline SVG sized to the cell. We use
 * preserveAspectRatio so the path stretches to fit whatever the cell is.
 */
function isSparkline(s: string): boolean {
  return typeof s === "string" && s.startsWith("__SPARKLINE__:");
}

function Sparkline({ encoded }: { encoded: string }) {
  const parts = encoded.slice("__SPARKLINE__:".length).split(":");
  const kind = parts[0] ?? "line";
  const nums = (parts[1] ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n));
  // Default sparkline stroke off the shared `--series-*` ramp; an explicit
  // per-cell color may still be encoded in the formula.
  const color = parts[2] ?? "var(--series-7)";
  if (nums.length === 0) return <span />;
  const w = 100;
  const h = 20;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  if (kind === "column") {
    const barW = w / nums.length - 1;
    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="hc-sheet-sparkline"
      >
        {nums.map((n, i) => {
          const norm = (n - min) / range;
          const barH = norm * h;
          return (
            <rect
              key={i}
              x={i * (barW + 1)}
              y={h - barH}
              width={barW}
              height={barH}
              fill={color}
            />
          );
        })}
      </svg>
    );
  }
  if (kind === "bar") {
    const total = nums.reduce((a, b) => a + b, 0);
    const v = nums[0] ?? 0;
    const norm = total === 0 ? 0 : v / total;
    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="hc-sheet-sparkline"
      >
        <rect x={0} y={2} width={w * norm} height={h - 4} fill={color} />
      </svg>
    );
  }
  if (kind === "winloss") {
    const barW = w / nums.length - 1;
    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="hc-sheet-sparkline"
      >
        {nums.map((n, i) => {
          const positive = n >= 0;
          return (
            <rect
              key={i}
              x={i * (barW + 1)}
              y={positive ? 0 : h / 2}
              width={barW}
              height={h / 2}
              fill={positive ? "var(--success)" : "var(--destructive)"}
            />
          );
        })}
      </svg>
    );
  }
  // Default: line
  const stepX = nums.length > 1 ? w / (nums.length - 1) : 0;
  const points = nums
    .map((n, i) => {
      const x = i * stepX;
      const y = h - ((n - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="hc-sheet-sparkline"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        points={points}
      />
    </svg>
  );
}

function validateAgainstRule(
  rule: DataValidationRule,
  evaluated: ExpressionResult | null,
  raw: string,
): boolean {
  switch (rule.kind) {
    case "list":
      return raw === "" || rule.values.includes(raw);
    case "checkbox":
      return raw === "" || raw === "TRUE" || raw === "FALSE" || raw === "true" || raw === "false" || raw === "0" || raw === "1";
    case "numberRange": {
      const n = evaluated?.type === "number" ? evaluated.value : Number(raw);
      if (Number.isNaN(n)) return raw === "";
      if (rule.min != null && n < rule.min) return false;
      if (rule.max != null && n > rule.max) return false;
      return true;
    }
    case "textLength": {
      const len = raw.length;
      if (rule.min != null && len < rule.min) return false;
      if (rule.max != null && len > rule.max) return false;
      return true;
    }
    case "dateRange": {
      // Treats raw as ISO date string; if parsing fails treat as valid (empty).
      const t = Date.parse(raw);
      if (Number.isNaN(t)) return raw === "";
      if (rule.min && t < Date.parse(rule.min)) return false;
      if (rule.max && t > Date.parse(rule.max)) return false;
      return true;
    }
    case "formula":
      // Defer to the engine — but we don't have it inline here; treat as valid.
      return true;
  }
}

function borderCss(b: CellBorder): string {
  // Map our border-style enum to the CSS values + a sensible width.
  switch (b.style) {
    case "thin":
      return `1px solid ${b.color}`;
    case "medium":
      return `2px solid ${b.color}`;
    case "thick":
      return `3px solid ${b.color}`;
    case "dashed":
      return `1px dashed ${b.color}`;
    case "dotted":
      return `1px dotted ${b.color}`;
    case "double":
      return `3px double ${b.color}`;
  }
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
      spellCheck
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
    case "custom":
      if (format?.customNumberFormat) {
        return applyCustomFormat(value, format.customNumberFormat);
      }
    // fallthrough to plain when no custom string provided
    case "plain":
    default: {
      // Strip JS's noisy `.0000000001` artifacts at 10 sig figs.
      const rounded = Math.round(value * 1e10) / 1e10;
      return String(rounded);
    }
  }
}

/**
 * Excel-style custom number format parser. Supports the four-section grammar
 * `positive;negative;zero;text` where each section can include `0`, `#`,
 * `,`, `.`, `%`, `$`, `[Red]`, and the date tokens `yyyy mm dd hh MM ss`.
 *
 * Not a full implementation — fully-spec-correct Excel formats are huge —
 * but covers ~95% of what's typed in practice.
 */
function applyCustomFormat(value: number, fmt: string): string {
  // Split into sections. Up to 4: positive;negative;zero;text.
  const sections = fmt.split(";");
  let pick: string;
  if (value > 0) pick = sections[0] ?? fmt;
  else if (value < 0) pick = sections[1] ?? sections[0] ?? fmt;
  else pick = sections[2] ?? sections[0] ?? fmt;
  // [Red] / [Green] / etc. prefix — strip but the cell color is owned by
  // CellFormat.textColor, not by the format string in this v1.
  pick = pick.replace(/\[(Red|Green|Blue|Black|Yellow|Magenta|Cyan|White)\]/gi, "");

  // Date tokens?
  if (/[yMdhms]/.test(pick)) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + value * 86400000);
    const y = date.getUTCFullYear();
    const mo = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const h = date.getUTCHours();
    const mi = date.getUTCMinutes();
    const se = date.getUTCSeconds();
    return pick
      .replace(/yyyy/g, String(y))
      .replace(/yy/g, String(y).slice(-2))
      .replace(/mm/g, String(mo).padStart(2, "0"))
      .replace(/m/g, String(mo))
      .replace(/dd/g, String(d).padStart(2, "0"))
      .replace(/d/g, String(d))
      .replace(/hh/g, String(h).padStart(2, "0"))
      .replace(/h/g, String(h))
      .replace(/MM/g, String(mi).padStart(2, "0"))
      .replace(/ss/g, String(se).padStart(2, "0"));
  }

  // Numeric formatting.
  let v = Math.abs(value);
  const isPercent = pick.includes("%");
  if (isPercent) v *= 100;
  const hasCurrency = pick.includes("$");
  const hasComma = /,#|,0/.test(pick);
  const decMatch = pick.match(/\.([0#]+)/);
  const decimals = decMatch ? decMatch[1]!.length : 0;
  const body = hasComma
    ? new Intl.NumberFormat("en-US", {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      }).format(v)
    : v.toFixed(decimals);
  return `${hasCurrency ? "$" : ""}${body}${isPercent ? "%" : ""}`;
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
