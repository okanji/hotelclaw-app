"use client";

/**
 * Formula bar — always-visible above the grid. Shows the active cell's raw
 * stored value (rewritten to A1 form for editing), and lets the user commit
 * an edit without entering the cell directly. Enter commits, Escape cancels.
 *
 * The bar is a controlled input but only when the user is editing it; while
 * the user navigates the grid we mirror the active cell's value into the
 * input by remounting (key on the cell coords + the version of the raw
 * value). This avoids fighting cursor position when the parent commits and
 * the focus is in the bar.
 */

import { useEffect, useRef, useState } from "react";
import { getColumnLabel, getRowLabel } from "@/lib/spreadsheet/formula/utils";

export function SheetFormulaBar({
  cellLabel,
  rawDisplay,
  disabled,
  onCommit,
}: {
  /** "A1" / "B12" — empty string when no selection. */
  cellLabel: string;
  /** The cell's raw value in A1 form. Empty string for empty cells. */
  rawDisplay: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(rawDisplay);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // External value changes (user selects a different cell, or the cell's
  // value updates from elsewhere) reset the bar unless the user is in the
  // middle of typing into the bar.
  useEffect(() => {
    if (!editing) setDraft(rawDisplay);
  }, [rawDisplay, editing]);

  function commit() {
    setEditing(false);
    if (draft !== rawDisplay) onCommit(draft);
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1 text-[12.5px]">
      <span className="w-14 shrink-0 truncate rounded border border-border/60 bg-background px-2 py-0.5 text-center font-mono text-[12px] text-muted-foreground">
        {cellLabel || "—"}
      </span>
      <span className="select-none font-mono text-muted-foreground">fx</span>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={draft}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(rawDisplay);
            setEditing(false);
            inputRef.current?.blur();
          }
        }}
        onBlur={commit}
        className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:text-muted-foreground/50"
        placeholder={disabled ? "Select a cell" : ""}
        spellCheck={false}
      />
    </div>
  );
}

export function cellLabelFor(
  colIndex: number,
  rowIndex: number,
): string {
  if (colIndex < 0 || rowIndex < 0) return "";
  return `${getColumnLabel(colIndex)}${getRowLabel(rowIndex)}`;
}
