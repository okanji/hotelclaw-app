"use client";

import { useId, useMemo, useState } from "react";
import { Plus, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useTaskLabels } from "@/components/workflows/builder/hooks/use-task-labels";

function humanizeLabel(token: string): string {
  const words = token.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function LabelChipSkeleton() {
  return (
    <span className="inline-block h-7 w-20 animate-pulse rounded-lg bg-muted" />
  );
}

export function LabelTriggerFilter({
  propertyId,
  selected,
  onChange,
  compact,
}: {
  propertyId?: string;
  selected: string[];
  onChange: (labels: string[]) => void;
  /** Inside flow-rail step — section title lives on the rail, not here. */
  compact?: boolean;
}) {
  const listId = useId();
  const { labels: known, loading } = useTaskLabels(propertyId);
  const [draft, setDraft] = useState("");

  const allOptions = useMemo(() => {
    const seen = new Set<string>(known);
    for (const s of selected) seen.add(s);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [known, selected]);

  function toggle(label: string) {
    if (selected.includes(label)) {
      onChange(selected.filter((l) => l !== label));
    } else {
      onChange([...selected, label]);
    }
  }

  function addCustom() {
    const t = draft.trim();
    if (!t || selected.includes(t)) return;
    onChange([...selected, t]);
    setDraft("");
  }

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {!compact && (
        <>
          <div className="flex items-center gap-2">
            <Tag className="size-3.5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">Which labels?</p>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Leave none selected to run when <span className="text-foreground/90">any</span> label
            is added. Click labels used on tasks in this property, or add a new one below.
          </p>
        </>
      )}

      <div className="space-y-2">
        {!compact && (
          <p className="text-xs font-medium text-faint-foreground">
            {loading ? "Loading labels…" : "Labels in this property"}
          </p>
        )}
        {compact && loading && (
          <p className="text-sm text-muted-foreground">Loading labels…</p>
        )}

        {loading ? (
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <LabelChipSkeleton key={i} />
            ))}
          </div>
        ) : allOptions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Task labels">
            {allOptions.map((label) => {
              const on = selected.includes(label);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(label)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    on
                      ? "bg-accent-pressed text-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent",
                  )}
                >
                  {humanizeLabel(label)}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No labels on tasks yet — add one on a task, or type a new label below.
          </p>
        )}

        {selected.length === 0 && !loading && (
          <p className="text-sm italic text-muted-foreground">Any label will trigger</p>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          list={listId}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={
            known.length > 0 ? "Or type a new label…" : "Type a label, e.g. guest-complaint"
          }
          className="h-8 text-sm"
        />
        <datalist id={listId}>
          {known.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={addCustom}
          disabled={!draft.trim()}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-background px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}
