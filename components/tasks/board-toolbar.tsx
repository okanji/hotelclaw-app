"use client";

import { useEffect, useRef } from "react";
import {
  CalendarRange,
  Check,
  Columns3,
  List,
  ListFilter,
  Search,
  Settings2,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PRIORITY_IDS,
  PRIORITY_META,
  SORT_LABELS,
  type SortBy,
} from "./kanban";
import { PriorityBars } from "./task-icons";
import type { TaskPriority } from "@/lib/db/types";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Status preset — the pill tabs at the left of the toolbar, modeled after
 * Linear's "All issues / Active / Backlog" workflow. Drives both the task
 * filter and (in the kanban view) which columns are visible.
 */
export type StatusPreset = "all" | "active" | "backlog";

export type BoardFilters = {
  search: string;
  priorities: TaskPriority[];
  sortBy: SortBy;
  /** Pill-tab preset. Replaces the old `hideDone` boolean. */
  statusPreset: StatusPreset;
};

export type ViewMode = "board" | "list" | "timeline";

const STATUS_TABS: { id: StatusPreset; label: string }[] = [
  { id: "all", label: "All issues" },
  { id: "active", label: "Active" },
  { id: "backlog", label: "Backlog" },
];

const VIEW_TABS: { id: ViewMode; label: string; Icon: typeof Columns3 }[] = [
  { id: "board", label: "Board", Icon: Columns3 },
  { id: "list", label: "List", Icon: List },
  { id: "timeline", label: "Timeline", Icon: CalendarRange },
];

const EMPTY_FILTERS: BoardFilters = {
  search: "",
  priorities: [],
  sortBy: "manual",
  statusPreset: "all",
};

export const DEFAULT_FILTERS = EMPTY_FILTERS;

type Props = {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  /** Total task count BEFORE filtering — used for the visible/total hint. */
  total: number;
  /** Task count AFTER filtering. */
  visible: number;
  mineOnly: boolean;
  onToggleMine: () => void;
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
};

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

export function BoardToolbar({
  filters,
  onChange,
  total,
  visible,
  mineOnly,
  onToggleMine,
  view,
  onChangeView,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);

  // `/` focuses search (Linear/GitHub convention). Skip when typing in
  // another input so we don't steal keystrokes mid-edit. Search lives inside
  // the Filter popover now, but the global shortcut still works — the
  // popover opens on focus via the ref + click.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (t?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const activeFilterCount =
    (filters.priorities.length > 0 ? 1 : 0) + (mineOnly ? 1 : 0);

  const sortDifferent = filters.sortBy !== "manual";

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3">
      {/* Left — status preset pills (All / Active / Backlog). */}
      <div
        role="tablist"
        aria-label="Status filter"
        className="flex items-center gap-0.5"
      >
        {STATUS_TABS.map(({ id, label }) => {
          const active = filters.statusPreset === id;
          return (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange({ ...filters, statusPreset: id })}
              className={cn(
                "inline-flex h-6 items-center rounded-full px-2.5 text-[0.75rem] font-medium transition-colors",
                active
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {/* Visible / total hint — only when filters are actively narrowing. */}
        {(activeFilterCount > 0 || filters.search.length > 0) && total > 0 ? (
          <span className="mr-1 hidden text-[0.75rem] text-muted-foreground tabular-nums sm:inline">
            {visible} of {total}
          </span>
        ) : null}

        {/* View mode — icon-only segmented group. Lives inline so the
            user can flip between Board/List/Timeline without a popover. */}
        <div
          role="tablist"
          aria-label="View mode"
          className="flex items-center gap-0.5"
        >
          {VIEW_TABS.map(({ id, label, Icon }) => {
            const active = view === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={label}
                title={label}
                onClick={() => onChangeView(id)}
                className={cn(
                  TOOLBAR_ICON_BUTTON,
                  active &&
                    "bg-foreground/[0.08] text-foreground hover:bg-foreground/[0.08]",
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>

        {/* Search — compact input. `/` keyboard shortcut still focuses it. */}
        <div className="relative ml-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchRef}
            type="search"
            name="board-search"
            aria-label="Search tasks"
            placeholder="Search…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className={cn(
              "h-7 w-44 rounded-md border border-border/60 bg-transparent pr-7 pl-7 text-[0.75rem]",
              "placeholder:text-muted-foreground/70",
              "transition-colors hover:border-border",
              "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              "[&::-webkit-search-cancel-button]:hidden",
            )}
          />
          {filters.search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange({ ...filters, search: "" })}
              className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd
              aria-hidden
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded border border-border/60 bg-muted/40 px-1 font-sans text-[0.625rem] text-muted-foreground"
            >
              /
            </kbd>
          )}
        </div>

        <FilterPopover
          filters={filters}
          onChange={onChange}
          mineOnly={mineOnly}
          onToggleMine={onToggleMine}
          activeCount={activeFilterCount}
        />
        <SortMenu
          filters={filters}
          onChange={onChange}
          modified={sortDifferent}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter popover                                                             */
/* -------------------------------------------------------------------------- */

function FilterPopover({
  filters,
  onChange,
  mineOnly,
  onToggleMine,
  activeCount,
}: {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  mineOnly: boolean;
  onToggleMine: () => void;
  activeCount: number;
}) {
  function togglePriority(p: TaskPriority) {
    onChange({
      ...filters,
      priorities: filters.priorities.includes(p)
        ? filters.priorities.filter((x) => x !== p)
        : [...filters.priorities, p],
    });
  }

  function reset() {
    onChange({ ...filters, priorities: [] });
    if (mineOnly) onToggleMine();
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Filter${activeCount > 0 ? ` (${activeCount} active)` : ""}`}
            title="Filter"
            className={TOOLBAR_ICON_BUTTON}
          />
        }
      >
        <span className="relative inline-flex">
          <ListFilter className="size-4" />
          {activeCount > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background"
            />
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-0 p-0">
        {/* Priority */}
        <PopoverSection label="Priority">
          {PRIORITY_IDS.map((p) => {
            const selected = filters.priorities.includes(p);
            const meta = PRIORITY_META[p];
            return (
              <PopoverRow
                key={p}
                onClick={() => togglePriority(p)}
                selected={selected}
              >
                <span className="flex w-4 items-center justify-center">
                  <PriorityBars priority={p} />
                </span>
                <span className="flex-1">{meta.label}</span>
              </PopoverRow>
            );
          })}
        </PopoverSection>

        {/* Scope */}
        <PopoverSection label="Scope">
          <PopoverRow onClick={onToggleMine} selected={mineOnly}>
            <span className="flex w-4 items-center justify-center text-muted-foreground">
              <UserIcon />
            </span>
            <span className="flex-1">Only assigned to me</span>
          </PopoverRow>
        </PopoverSection>

        {/* Footer */}
        {activeCount > 0 ? (
          <div className="border-t border-border/60 p-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-full justify-start px-1.5 text-[0.75rem] text-muted-foreground hover:text-foreground"
              onClick={reset}
            >
              Clear filters
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Sort menu                                                                  */
/* -------------------------------------------------------------------------- */

function SortMenu({
  filters,
  onChange,
  modified,
}: {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  modified: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Sort${modified ? ` by ${SORT_LABELS[filters.sortBy].toLowerCase()}` : ""}`}
            title="Sort"
            className={TOOLBAR_ICON_BUTTON}
          />
        }
      >
        <span className="relative inline-flex">
          <Settings2 className="size-4" />
          {modified ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background"
            />
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 gap-0 p-0">
        <PopoverSection label="Ordering">
          {(Object.keys(SORT_LABELS) as SortBy[]).map((key) => {
            const selected = filters.sortBy === key;
            return (
              <PopoverRow
                key={key}
                onClick={() => onChange({ ...filters, sortBy: key })}
                selected={selected}
              >
                <span className="flex-1">{SORT_LABELS[key]}</span>
              </PopoverRow>
            );
          })}
        </PopoverSection>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Popover primitives                                                         */
/* -------------------------------------------------------------------------- */

function PopoverSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/60 py-1.5 last:border-b-0">
      <div className="px-2.5 pt-0.5 pb-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="flex flex-col gap-px px-1">{children}</div>
    </div>
  );
}

function PopoverRow({
  onClick,
  selected,
  children,
}: {
  onClick: () => void;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-[0.8125rem] transition-colors",
        "hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:outline-none",
        selected ? "text-foreground" : "text-foreground/90",
      )}
    >
      {children}
      {selected ? (
        <Check className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
    </button>
  );
}

const TOOLBAR_ICON_BUTTON = cn(
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
  "hover:bg-foreground/[0.06] hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "aria-expanded:bg-foreground/[0.06] aria-expanded:text-foreground",
  "data-popup-open:bg-foreground/[0.06] data-popup-open:text-foreground",
);

function UserIcon() {
  // Inline user icon matches the unassigned-avatar weight used on cards.
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="6" r="2.5" />
      <path d="M3.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
    </svg>
  );
}
