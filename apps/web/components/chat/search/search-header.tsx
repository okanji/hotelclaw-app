"use client";

import { Search, ArrowDownUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchFilterChips } from "./search-filter-chips";
import type { SearchState } from "./parse-search-params";

type Props = {
  propertyId: string;
  state: SearchState;
  draftQuery: string;
  onDraftChange: (q: string) => void;
  onChange: (patch: Partial<SearchState>) => void;
  resultCountLabel: string | null;
};

export function SearchHeader({
  propertyId,
  state,
  draftQuery,
  onDraftChange,
  onChange,
  resultCountLabel,
}: Props) {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-background px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search messages…"
            value={draftQuery}
            onChange={(e) => onDraftChange(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({ sort: state.sort === "newest" ? "oldest" : "newest" })
          }
          className="gap-1.5"
          title={`Sort: ${state.sort === "newest" ? "Newest first" : "Oldest first"}`}
        >
          <ArrowDownUp className="size-4" />
          {state.sort === "newest" ? "Newest" : "Oldest"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchFilterChips
          propertyId={propertyId}
          state={state}
          onChange={onChange}
        />
        {resultCountLabel ? (
          <span className="text-xs text-muted-foreground">
            {resultCountLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
