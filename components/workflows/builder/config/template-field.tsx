"use client";

import { useMemo, useRef, useState } from "react";
import { Braces, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { groupRefs, type RefCandidate } from "@/lib/workflows/refs";
import { humanizeRef } from "@/lib/workflows/explain-expr";

// A string config field that can embed {{data.refs}}. The "{ }" button opens a
// picker so the user never types a dotted path; chosen data inserts at the
// caret as `{{path}}` and is echoed below as friendly pills. The stored value
// stays exactly `{{...}}` so the resolver + validator are unaffected.
//
// We render native <input>/<textarea> (not the ui wrappers) because we need a
// stable DOM ref for caret-aware insertion.

const FIELD_BASE =
  "w-full rounded-lg border border-input bg-transparent px-2.5 text-[13px] transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function TemplateField({
  value,
  onChange,
  onBlur,
  placeholder,
  multiline,
  rows = 3,
  mono,
  refs,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  refs: RefCandidate[];
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

  return (
    <div className="space-y-1">
      <div className="relative">
        {multiline ? (
          <textarea
            ref={elRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder={placeholder}
            rows={rows}
            className={cn(FIELD_BASE, "min-h-[72px] py-2 pr-9", mono && "font-mono text-[12px]")}
          />
        ) : (
          <input
            ref={elRef as React.RefObject<HTMLInputElement>}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder={placeholder}
            className={cn(FIELD_BASE, "h-9 pr-9", mono && "font-mono text-[12px]")}
          />
        )}
        <InsertDataPopover refs={refs} onInsert={insertRef}>
          <PopoverTrigger
            className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="Insert data"
            aria-label="Insert data"
          >
            <Braces className="size-3.5" aria-hidden />
          </PopoverTrigger>
        </InsertDataPopover>
      </div>
      <RefPreview value={value} />
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
        <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search data to insert…"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              No data available here yet.
            </p>
          ) : (
            groups.map(({ group, items }) => (
              <div key={group} className="mb-1.5 last:mb-0">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
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
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                      {r.label}
                    </span>
                    {r.sample ? (
                      <span className="max-w-[40%] truncate text-[11px] text-muted-foreground">
                        {r.sample}
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        {r.type}
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
      <span className="text-[10.5px] text-muted-foreground">inserts</span>
      {refs.map((r, i) => (
        <span
          key={`${r}-${i}`}
          className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium text-primary"
        >
          {humanizeRef(r)}
        </span>
      ))}
    </div>
  );
}
