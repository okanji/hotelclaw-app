"use client";

/**
 * Minimal named-ranges manager. Lives in a Radix Popover anchored to a
 * toolbar button. Lists existing names, allows add (using the current
 * selection as the new range), and delete.
 *
 * Naming rules: same as Excel — letters, digits, underscore; can't start
 * with a digit; max ~80 chars. We enforce client-side; the storage layer
 * is permissive.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;

export type NamedRangeRow = {
  name: string;
  sheetId: string;
  startRef: string;
  endRef: string;
  /** A1 display: e.g. `Sheet1!A1:B5`. Computed by the parent. */
  display: string;
};

export function SheetNamedRangesPanel({
  ranges,
  hasSelection,
  selectionDisplay,
  onAdd,
  onDelete,
}: {
  ranges: NamedRangeRow[];
  hasSelection: boolean;
  /** A1 display of the current selection — preview text on the add row. */
  selectionDisplay: string;
  onAdd: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!NAME_RE.test(trimmed)) {
      setError("Name must start with a letter or _ and use only letters/digits/_");
      return;
    }
    if (ranges.some((r) => r.name === trimmed)) {
      setError("That name is taken");
      return;
    }
    if (!hasSelection) {
      setError("Select a range first");
      return;
    }
    setError(null);
    setDraft("");
    onAdd(trimmed);
  }

  return (
    <div className="w-80 p-2">
      <div className="mb-2 text-xs font-medium text-foreground">
        Named ranges
      </div>
      {ranges.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">
          No named ranges yet. Use them in formulas like{" "}
          <code className="rounded-md bg-muted px-1 text-xs">=SUM(Revenue)</code>.
        </p>
      ) : (
        <ul className="mb-2 max-h-64 overflow-y-auto">
          {ranges.map((r) => (
            <li
              key={r.name}
              className="group flex items-center justify-between rounded-md py-1 pl-2 pr-1 hover:bg-muted"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {r.display}
                </div>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Delete"
                onClick={() => onDelete(r.name)}
                className="size-6 opacity-50 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-md bg-muted p-2">
        <div className="mb-1 text-xs leading-3 font-medium text-faint-foreground">
          Add named range
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="Name (e.g. Revenue)"
          className="mb-1 w-full rounded-md bg-card px-2 py-1 text-sm shadow-ring outline-none focus-visible:shadow-focus"
        />
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="truncate font-mono text-xs text-muted-foreground">
            {hasSelection ? selectionDisplay : "Select a range first"}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={!hasSelection || draft.trim().length === 0}
            className="h-7 px-2 text-xs"
          >
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
