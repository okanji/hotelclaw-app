"use client";

/**
 * Find / replace dialog. Floats over the grid; Cmd+F opens find, Cmd+H opens
 * replace. Match navigation is local state in the surface (`matchIndex`),
 * the parent decides which match is the "active" one and scrolls it into
 * view + highlights via cell `data-active-match`.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Regex,
  Replace,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FindMatch = { columnId: string; rowId: string };

export function SheetFindReplace({
  query,
  replacement,
  caseSensitive,
  useRegex,
  matches,
  activeMatchIndex,
  showReplace,
  onChangeQuery,
  onChangeReplacement,
  onToggleCase,
  onToggleRegex,
  onPrev,
  onNext,
  onReplaceOne,
  onReplaceAll,
  onClose,
}: {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  useRegex: boolean;
  matches: FindMatch[];
  activeMatchIndex: number;
  showReplace: boolean;
  onChangeQuery: (v: string) => void;
  onChangeReplacement: (v: string) => void;
  onToggleCase: () => void;
  onToggleRegex: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}) {
  const findInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [showReplace]);

  const summary = useMemo(() => {
    if (query.length === 0) return "—";
    if (matches.length === 0) return "0 / 0";
    return `${activeMatchIndex + 1} / ${matches.length}`;
  }, [query, matches.length, activeMatchIndex]);

  return (
    <div className="absolute right-4 top-4 z-10 flex w-80 flex-col gap-1.5 rounded-lg border border-border/60 bg-popover p-2 shadow-lg ring-1 ring-foreground/5">
      <div className="flex items-center gap-1">
        <input
          ref={findInputRef}
          type="text"
          value={query}
          onChange={(e) => onChangeQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Find"
          className="flex-1 min-w-0 rounded-md border border-border/60 bg-background px-2 py-1 text-[13px] outline-none focus:border-foreground/30"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title="Match case"
          onClick={onToggleCase}
          className={cn("size-7", caseSensitive && "bg-muted text-foreground")}
        >
          <CaseSensitive className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title="Regex"
          onClick={onToggleRegex}
          className={cn("size-7", useRegex && "bg-muted text-foreground")}
        >
          <Regex className="size-4" />
        </Button>
      </div>
      <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span className="tabular-nums">{summary}</span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Previous (Shift+Enter)"
            onClick={onPrev}
            disabled={matches.length === 0}
            className="size-6"
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Next (Enter)"
            onClick={onNext}
            disabled={matches.length === 0}
            className="size-6"
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Close (Esc)"
            onClick={onClose}
            className="size-6"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {showReplace ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={replacement}
            onChange={(e) => onChangeReplacement(e.target.value)}
            placeholder="Replace with"
            className="flex-1 min-w-0 rounded-md border border-border/60 bg-background px-2 py-1 text-[13px] outline-none focus:border-foreground/30"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onReplaceOne}
            disabled={matches.length === 0}
            className="h-7 px-2 text-[12px]"
            title="Replace current"
          >
            <Replace className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onReplaceAll}
            disabled={matches.length === 0}
            className="h-7 px-2 text-[12px]"
            title="Replace all"
          >
            All
          </Button>
        </div>
      ) : null}
    </div>
  );
}
