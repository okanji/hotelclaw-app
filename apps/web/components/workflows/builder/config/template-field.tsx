"use client";

import { useMemo, useRef, useState } from "react";
import { Database, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { groupRefs, type RefCandidate, type RefType } from "@/lib/workflows/refs";
import { humanizeRef } from "@/lib/workflows/explain-expr";

/** Plain-English names for the coarse ref types shown in the picker. */
const FRIENDLY_TYPE: Record<RefType, string> = {
  string: "Text",
  number: "Number",
  boolean: "Yes / no",
  "string[]": "List",
  date: "Date",
  json: "Data",
};

// A string config field that can also pull in live data. Users never see or
// type a {{dotted.path}}:
//   • "Insert data" opens a picker; the chosen data drops in at the caret.
//   • When the whole value IS one piece of data, we render it as a friendly
//     chip (e.g. "Description · From the trigger") instead of raw braces.
//   • Mixed text + data still shows the chosen data as readable pills below.
// The stored value stays exactly `{{...}}` so the resolver + validator are
// unaffected — only the presentation changes.
//
// We render native <input>/<textarea> (not the ui wrappers) because we need a
// stable DOM ref for caret-aware insertion.

const FIELD_BASE =
  "w-full rounded-lg bg-transparent px-3 text-sm transition-colors outline-none placeholder:text-muted-foreground/70 focus-visible:shadow-focus dark:bg-input/30";

/** A value that is exactly one `{{ref}}` and nothing else → its inner path. */
function pureRefPath(value: string): string | null {
  const m = (value ?? "").match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  return m ? m[1]!.trim() : null;
}

export function TemplateField({
  value,
  onChange,
  onBlur,
  placeholder,
  multiline,
  rows = 3,
  mono,
  refs,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  refs: RefCandidate[];
  invalid?: boolean;
}) {
  const elRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  function insertRef(path: string) {
    const token = `{{${path}}}`;
    const el = elRef.current;
    const cur = value ?? "";
    if (!el) {
      onChange(cur + token);
      return;
    }
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + token + cur.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* non-text inputs */
      }
    });
  }

  // Bound state: the whole value is a single data ref → show a friendly chip.
  const boundPath = pureRefPath(value);
  if (boundPath) {
    const cand = refs.find((r) => r.path === boundPath);
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted py-1.5 pr-1.5 pl-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-sm font-medium text-primary">
            <Database className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{cand?.label ?? humanizeRef(boundPath)}</span>
          </span>
          {cand?.group && (
            <span className="truncate text-sm text-muted-foreground">
              {cand.group}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <InsertDataPopover refs={refs} onInsert={(p) => onChange(`{{${p}}}`)}>
            <PopoverTrigger
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
              title="Pick different data"
            >
              Change
            </PopoverTrigger>
          </InsertDataPopover>
          <button
            type="button"
            onClick={() => {
              onChange("");
              requestAnimationFrame(() => elRef.current?.focus());
            }}
            aria-label="Clear data"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="size-4" aria-hidden />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {multiline ? (
        <textarea
          ref={elRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={rows}
          aria-invalid={invalid || undefined}
          className={cn(
            FIELD_BASE,
            "min-h-[72px] py-2",
            mono && "font-mono",
            invalid && "shadow-[0_0_0_1px_var(--destructive)]",
          )}
        />
      ) : (
        <input
          ref={elRef as React.RefObject<HTMLInputElement>}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          className={cn(
            FIELD_BASE,
            "h-9",
            mono && "font-mono",
            invalid && "shadow-[0_0_0_1px_var(--destructive)]",
          )}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <InsertDataPopover refs={refs} onInsert={insertRef}>
          <PopoverTrigger
            className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
            title="Insert data from the trigger or an earlier step"
          >
            <Database className="size-3.5" aria-hidden /> Insert data
          </PopoverTrigger>
        </InsertDataPopover>
        <RefPreview value={value} />
      </div>
    </div>
  );
}

// ─── Insert-data popover ──────────────────────────────────────────────────────

export function InsertDataPopover({
  refs,
  onInsert,
  children,
}: {
  refs: RefCandidate[];
  onInsert: (path: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? refs.filter(
          (r) =>
            r.label.toLowerCase().includes(q) ||
            r.path.toLowerCase().includes(q) ||
            r.group.toLowerCase().includes(q),
        )
      : refs;
    return groupRefs(filtered);
  }, [refs, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setQuery("");
      }}
    >
      {children}
      <PopoverContent align="end" sideOffset={6} className="w-80 gap-0 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search data to insert…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No data available here yet.
            </p>
          ) : (
            groups.map(({ group, items }) => (
              <div key={group} className="mb-1.5 last:mb-0">
                <p className="px-2 py-1 text-xs font-medium text-faint-foreground">
                  {group}
                </p>
                {items.map((r) => (
                  <button
                    key={r.path}
                    type="button"
                    onClick={() => {
                      onInsert(r.path);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {r.label}
                    </span>
                    {r.sample ? (
                      <span className="max-w-[40%] truncate text-xs text-muted-foreground">
                        e.g. {r.sample}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/70">
                        {FRIENDLY_TYPE[r.type]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Ref pills preview ────────────────────────────────────────────────────────

function RefPreview({ value }: { value: string }) {
  const refs = useMemo(() => {
    const out: string[] = [];
    // Fresh regex per call — never mutate a shared one (React Compiler).
    for (const m of (value || "").matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      out.push(m[1]!.trim());
    }
    return out;
  }, [value]);

  if (refs.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted-foreground">includes</span>
      {refs.map((r, i) => (
        <span
          key={`${r}-${i}`}
          className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
        >
          {humanizeRef(r)}
        </span>
      ))}
    </div>
  );
}
