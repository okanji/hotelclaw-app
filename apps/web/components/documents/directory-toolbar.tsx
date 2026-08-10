"use client";

import { ChevronDown, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NewDocumentMenu } from "./quick-create-row";

/* ────────────────────────────────────────────────────────────────────────── */
/*  The Directory's view state — one type, shared with `documents-home`       */
/* ────────────────────────────────────────────────────────────────────────── */

export type DirectoryKind = "all" | "doc" | "sheet";
export type DirectorySort = "recent" | "created" | "title";
/** `"all"` · `"general"` (no team) · a space id. */
export type DirectoryTeam = string;

export type DirectoryView = {
  query: string;
  kind: DirectoryKind;
  team: DirectoryTeam;
  sort: DirectorySort;
};

export const DEFAULT_DIRECTORY_VIEW: DirectoryView = {
  query: "",
  kind: "all",
  team: "all",
  sort: "recent",
};

const KIND_LABEL: Record<DirectoryKind, string> = {
  all: "All types",
  doc: "Documents",
  sheet: "Spreadsheets",
};

const SORT_LABEL: Record<DirectorySort, string> = {
  recent: "Recently edited",
  created: "Recently created",
  title: "Title A–Z",
};

export type TeamOption = { id: string; name: string; icon: string | null; count: number };

/**
 * The Directory's one control bar: find, narrow, order, create — in that
 * order, because on a library of documents *finding* is the primary act and
 * creating is the occasional one.
 *
 * It replaces three separate affordances the page used to stack vertically (a
 * five-tile create row, a floating search dropdown, and a strip of team chips
 * buried below the fold), which is what pushed the actual document list a full
 * screen down the page.
 *
 * Every control is a dropdown rather than a chip strip so the bar's height is
 * constant no matter how many teams a property has — it sticks to the top of
 * the scroller, and a bar that reflows as you scroll reads as broken.
 */
export function DirectoryToolbar({
  propertyId,
  view,
  onChange,
  teams,
  generalCount,
  onGenerate,
  resultCount,
}: {
  propertyId: string;
  view: DirectoryView;
  onChange: (next: Partial<DirectoryView>) => void;
  teams: TeamOption[];
  generalCount: number;
  onGenerate: () => void;
  /** Rendered beside the search field while a query is active. */
  resultCount: number | null;
}) {
  const teamLabel =
    view.team === "all"
      ? "All teams"
      : view.team === "general"
        ? "General"
        : (teams.find((t) => t.id === view.team)?.name ?? "All teams");

  const filtered = view.kind !== "all" || view.team !== "all";

  return (
    <div
      // Sticky against the page scroller so the controls stay reachable in a
      // long library. `bg-card` is the PANE canvas (the `<main>` this renders
      // in) — not `bg-background`, which is the shell plane and would paint a
      // visibly grey band across the page. Without a fill, rows scroll through
      // the bar. The `-mx-2 px-2` bleed keeps the fill under the leftmost
      // control's hover/focus box without moving the column's left edge.
      className="sticky top-0 z-20 -mx-2 flex flex-wrap items-center gap-2 bg-card px-2 py-3"
    >
      <div className="relative min-w-56 flex-1 sm:max-w-sm">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint-foreground"
        />
        <Input
          type="search"
          value={view.query}
          onChange={(e) => onChange({ query: e.target.value })}
          placeholder="Search title and body…"
          aria-label="Search documents"
          // `type=search` gets us the semantics and the Escape-to-clear
          // behaviour, but WebKit also paints its own cancel button — which
          // sat right beside ours, giving the field two ✕ controls.
          className="h-8 pr-8 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {view.query ? (
          <button
            type="button"
            onClick={() => onChange({ query: "" })}
            aria-label="Clear search"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-faint-foreground transition-colors hover:bg-accent"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {resultCount !== null ? (
        <span
          aria-live="polite"
          className="text-xs text-faint-foreground tabular-nums"
        >
          {resultCount} {resultCount === 1 ? "result" : "results"}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <FilterMenu label={KIND_LABEL[view.kind]} active={view.kind !== "all"}>
          <DropdownMenuRadioGroup
            value={view.kind}
            onValueChange={(v) => onChange({ kind: v as DirectoryKind })}
          >
            {(Object.keys(KIND_LABEL) as DirectoryKind[]).map((k) => (
              <DropdownMenuRadioItem key={k} value={k} closeOnClick>
                {KIND_LABEL[k]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </FilterMenu>

        {teams.length > 0 ? (
          <FilterMenu
            label={teamLabel}
            active={view.team !== "all"}
            icon={<Users className="size-3.5 text-faint-foreground" />}
          >
            <DropdownMenuRadioGroup
              value={view.team}
              onValueChange={(v) => onChange({ team: v })}
            >
              <DropdownMenuRadioItem value="all" closeOnClick>All teams</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {teams.map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.id} closeOnClick>
                  {t.icon ? <span aria-hidden>{t.icon}</span> : null}
                  <span className="flex-1">{t.name}</span>
                  <span className="text-xs text-faint-foreground tabular-nums">
                    {t.count}
                  </span>
                </DropdownMenuRadioItem>
              ))}
              {generalCount > 0 ? (
                <DropdownMenuRadioItem value="general" closeOnClick>
                  <span className="flex-1">General</span>
                  <span className="text-xs text-faint-foreground tabular-nums">
                    {generalCount}
                  </span>
                </DropdownMenuRadioItem>
              ) : null}
            </DropdownMenuRadioGroup>
          </FilterMenu>
        ) : null}

        {/* No "Sort by" heading: `DropdownMenuLabel` is base-ui's
            `Menu.GroupLabel` and THROWS unless it is inside a `Menu.Group` —
            a `RadioGroup` does not satisfy it (it crashed the page). The
            trigger already reads out the active sort, so the heading was
            redundant chrome regardless. */}
        <FilterMenu label={SORT_LABEL[view.sort]} active={false}>
          <DropdownMenuRadioGroup
            value={view.sort}
            onValueChange={(v) => onChange({ sort: v as DirectorySort })}
          >
            {(Object.keys(SORT_LABEL) as DirectorySort[]).map((s) => (
              <DropdownMenuRadioItem key={s} value={s} closeOnClick>
                {SORT_LABEL[s]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </FilterMenu>

        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ kind: "all", team: "all" })}
          >
            Clear
          </Button>
        ) : null}

        <NewDocumentMenu propertyId={propertyId} onGenerate={onGenerate} />
      </div>
    </div>
  );
}

/** A ghost trigger that goes warm-pressed while its filter is narrowing. */
function FilterMenu({
  label,
  active,
  icon,
  children,
}: {
  label: string;
  active: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(active && "bg-accent-pressed text-foreground")}
          />
        }
      >
        {icon}
        {label}
        <ChevronDown className="opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
