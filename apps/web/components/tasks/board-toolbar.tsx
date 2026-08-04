"use client";

import { useEffect, useRef } from "react";
import {
  CalendarRange,
  Check,
  Columns3,
  List,
  Search,
  Settings2,
  Users,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import { cn } from "@/lib/utils";
import { SORT_LABELS } from "./kanban";
import { TriageDial } from "./triage-dial";
import { CustomFieldManager } from "./custom-field-manager";
import { useQuery } from "@tanstack/react-query";
import { customFieldsQueryOptions } from "@/lib/query/custom-field-queries";
import {
  EMPTY_FILTERS,
  FilterMenu,
  activeFacetCount,
  type BoardFilters,
  type FacetKey,
} from "./board-filters";

export type { BoardFilters };

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Status preset — the pill tabs at the left of the toolbar, modeled after
 * Linear's "All issues / Active / Backlog" workflow. Drives both the task
 * filter and (in the kanban view) which columns are visible.
 */
export type StatusPreset = "all" | "active" | "backlog";

export type ViewMode = "board" | "list" | "timeline" | "workload";

/** How the board view groups columns — by status (default), space, or project. */
export type BoardGroupBy = "status" | "space" | "project";

const GROUP_LABELS: Record<BoardGroupBy, string> = {
  status: "Status",
  space: "Team",
  project: "Project",
};

const STATUS_TABS: { id: StatusPreset; label: string }[] = [
  { id: "all", label: "All issues" },
  { id: "active", label: "Active" },
  { id: "backlog", label: "Backlog" },
];

const VIEW_TABS: { id: ViewMode; label: string; Icon: typeof Columns3 }[] = [
  { id: "board", label: "Board", Icon: Columns3 },
  { id: "list", label: "List", Icon: List },
  { id: "timeline", label: "Timeline", Icon: CalendarRange },
  { id: "workload", label: "Workload", Icon: Users },
];

export const DEFAULT_FILTERS = EMPTY_FILTERS;

type Props = {
  propertyId: string;
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  /** Total task count BEFORE filtering — used for the visible/total hint. */
  total: number;
  /** Task count AFTER filtering. */
  visible: number;
  /** Add a facet from the "+ Filter" menu — the board opens it as a chip. */
  onPickFacet: (facet: FacetKey) => void;
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
  groupBy: BoardGroupBy;
  onChangeGroupBy: (groupBy: BoardGroupBy) => void;
};

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

export function BoardToolbar({
  propertyId,
  filters,
  onChange,
  total,
  visible,
  onPickFacet,
  view,
  onChangeView,
  groupBy,
  onChangeGroupBy,
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

  const activeFilterCount = activeFacetCount(filters);
  // Offered as filter dimensions in the "+ Filter" menu alongside built-ins.
  const { data: customFields = [] } = useQuery(
    customFieldsQueryOptions(propertyId),
  );

  const sortDifferent =
    filters.sortKeys.length > 0 || filters.sortBy !== "manual";

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3">
      {/* Left — status preset pills (All / Active / Backlog). */}
      <TabNav variant="pill" aria-label="Status filter">
        {STATUS_TABS.map(({ id, label }) => (
          <TabNavItem
            key={id}
            active={filters.statusPreset === id}
            onClick={() => onChange({ ...filters, statusPreset: id })}
          >
            {label}
          </TabNavItem>
        ))}
      </TabNav>

      <div className="ml-auto flex items-center gap-1">
        {/* Visible / total hint — only when filters are actively narrowing. */}
        {(activeFilterCount > 0 || filters.search.length > 0) && total > 0 ? (
          <span className="mr-1 hidden text-xs text-faint-foreground tabular-nums sm:inline">
            {visible} of {total}
          </span>
        ) : null}

        {/* View mode — explicit labeled buttons for clarity while keeping
            the same minimal toolbar density. */}
        <TabNav variant="pill" aria-label="View mode">
          {VIEW_TABS.map(({ id, label, Icon }) => (
            <TabNavItem key={id} active={view === id} onClick={() => onChangeView(id)}>
              <Icon />
              <span>{label}</span>
            </TabNavItem>
          ))}
        </TabNav>

        {/* Group-by — only meaningful for the board view. */}
        {view === "board" ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                />
              }
            >
              <Columns3 className="size-3.5" />
              Group: {GROUP_LABELS[groupBy]}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              {(["status", "space", "project"] as BoardGroupBy[]).map((g) => (
                <DropdownMenuItem key={g} onClick={() => onChangeGroupBy(g)}>
                  <span className="flex-1">{GROUP_LABELS[g]}</span>
                  {g === groupBy ? <Check className="size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <CustomFieldManager propertyId={propertyId} />

        <TriageDial propertyId={propertyId} />

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
              "h-7 w-44 rounded-md bg-accent pr-7 pl-7 text-xs shadow-none",
              "placeholder:text-faint-foreground",
              "transition-colors",
              "focus-visible:shadow-focus focus-visible:outline-none",
              "[&::-webkit-search-cancel-button]:hidden",
            )}
          />
          {filters.search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange({ ...filters, search: "" })}
              className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd
              aria-hidden
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md px-1 font-sans text-xs text-faint-foreground"
            >
              /
            </kbd>
          )}
        </div>

        <FilterMenu
          filters={filters}
          onPick={onPickFacet}
          customFields={customFields}
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
            aria-label={`Sort${
              filters.sortKeys.length > 0
                ? ` by ${filters.sortKeys
                    .map((k) => SORT_LABELS[k].toLowerCase())
                    .join(", then ")}`
                : modified
                  ? ` by ${SORT_LABELS[filters.sortBy].toLowerCase()}`
                  : ""
            }`}
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
          <PopoverRow
            onClick={() =>
              onChange({ ...filters, sortBy: "manual", sortKeys: [] })
            }
            selected={
              filters.sortKeys.length === 0 && filters.sortBy === "manual"
            }
          >
            <span className="flex-1">Manual order</span>
          </PopoverRow>
          {(["priority", "due_at"] as const).map((key) => {
            const index = filters.sortKeys.indexOf(key);
            const selected = index !== -1;
            return (
              <PopoverRow
                key={key}
                onClick={() =>
                  onChange({
                    ...filters,
                    sortBy: "manual",
                    // Click to stack; click again to unstack (ClickUp's
                    // click-in-succession multi-sort).
                    sortKeys: selected
                      ? filters.sortKeys.filter((k) => k !== key)
                      : [...filters.sortKeys, key],
                  })
                }
                selected={selected}
              >
                <span className="flex-1">{SORT_LABELS[key]}</span>
                {selected && filters.sortKeys.length > 1 ? (
                  <span className="rounded-md bg-muted px-1.5 text-xs font-medium tabular-nums text-faint-foreground">
                    {index + 1}
                  </span>
                ) : null}
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
    <div className="border-b border-border py-1.5 last:border-b-0">
      <div className="px-2.5 pt-0.5 pb-1 text-xs/[1] font-medium text-faint-foreground">
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
        "flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-sm transition-colors",
        "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        selected ? "text-foreground" : "text-secondary-ink",
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
  "hover:bg-accent",
  "focus-visible:outline-none focus-visible:shadow-focus",
  "aria-expanded:bg-accent-pressed aria-expanded:text-foreground",
  "data-popup-open:bg-accent-pressed data-popup-open:text-foreground",
);
