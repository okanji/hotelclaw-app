"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarRange,
  Check,
  Columns3,
  List,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { isChoiceField } from "@/lib/tasks/custom-field-options";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import { cn } from "@/lib/utils";
import { SORT_LABELS } from "./kanban";
import { TriageDial } from "./triage-dial";
import { AutomationsButton } from "@/components/workflows/automations-button";
import { CustomFieldManagerDialog } from "./custom-field-manager";
import { useQuery } from "@tanstack/react-query";
import {
  customFieldsQueryOptions,
  type CustomFieldRow,
} from "@/lib/query/custom-field-queries";
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

/**
 * How the board view groups columns — by status (default), space, project,
 * or a choice custom field (`field:<uuid>`, ClickUp's group-by-dropdown/label).
 */
export type BoardGroupBy = "status" | "space" | "project" | `field:${string}`;

const GROUP_LABELS: Record<"status" | "space" | "project", string> = {
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
  // Search is a glyph until asked for (Linear's header): the input unfolds
  // on click or `/` and folds away again once it is empty and blurred.
  const [searchOpen, setSearchOpen] = useState(filters.search.length > 0);
  const searchVisible = searchOpen || filters.search.length > 0;

  // `/` focuses search (Linear/GitHub convention). Skip when typing in
  // another input so we don't steal keystrokes mid-edit.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (t?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      setSearchOpen(true);
      // The input may not exist yet on this frame.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const activeFilterCount = activeFacetCount(filters);
  // Offered as filter dimensions in the "+ Filter" menu alongside built-ins.
  const { data: customFields = [] } = useQuery(
    customFieldsQueryOptions(propertyId),
  );

  return (
    // Linear's view row: presets + Filter on the left, ONE Display control on
    // the right. Everything that configures how the list LOOKS (layout,
    // grouping, ordering, fields) lives behind Display; only the two
    // AI/automation entry points keep a glyph of their own. The row is 40px
    // with the content pulled up (`pb-1`) so the pills sit clear of the rule.
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-(--page-gutter) pb-1">
      {/* Left — status preset pills (All / Active / Backlog). Compact pill,
          full-size label. */}
      <TabNav variant="pill" aria-label="Status filter" className="gap-0.5">
        {STATUS_TABS.map(({ id, label }) => (
          <TabNavItem
            key={id}
            active={filters.statusPreset === id}
            onClick={() => onChange({ ...filters, statusPreset: id })}
            className="h-7 px-2.5"
          >
            {label}
          </TabNavItem>
        ))}
      </TabNav>

      {/* Filter — Linear puts this at the LEFT so filtering is discoverable
          from the toolbar itself, not tucked behind an icon at the far end. */}
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <FilterMenu
        filters={filters}
        onPick={onPickFacet}
        customFields={customFields}
      />

      <div className="ml-auto flex items-center gap-0.5">
        {/* Visible / total hint — only when filters are actively narrowing. */}
        {(activeFilterCount > 0 || filters.search.length > 0) && total > 0 ? (
          <span className="mr-1.5 hidden text-xs text-faint-foreground tabular-nums sm:inline">
            {visible} of {total}
          </span>
        ) : null}

        {/* Search — a glyph that unfolds into the input. */}
        {searchVisible ? (
          <div className="relative mr-1">
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
              autoFocus
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              onBlur={() => {
                if (!filters.search) setSearchOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onChange({ ...filters, search: "" });
                  setSearchOpen(false);
                  e.currentTarget.blur();
                }
              }}
              className={cn(
                // The QUERY is a value the user types, so it reads on the UI
                // rung (14px), not the metadata rung.
                "h-7 w-48 rounded-md bg-accent pr-7 pl-7 text-sm shadow-none",
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
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ ...filters, search: "" });
                  setSearchOpen(false);
                }}
                className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent-pressed"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            aria-label="Search tasks"
            title="Search  /"
            onClick={() => setSearchOpen(true)}
            className={TOOLBAR_ICON_BUTTON}
          >
            <Search className="size-4" />
          </button>
        )}

        <TriageDial propertyId={propertyId} showLabel={false} />

        <AutomationsButton
          propertyId={propertyId}
          feature="tasks"
          showLabel={false}
          className="text-muted-foreground"
        />

        <DisplayMenu
          propertyId={propertyId}
          filters={filters}
          onChange={onChange}
          view={view}
          onChangeView={onChangeView}
          groupBy={groupBy}
          onChangeGroupBy={onChangeGroupBy}
          customFields={customFields}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Display menu                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Linear's "Display" popover: layout, grouping, ordering and the fields
 * manager in one place. The trigger carries a dot whenever the list is
 * showing something other than its defaults (a non-status grouping or a
 * non-manual order), so a customised view is visible from the bar.
 */
function DisplayMenu({
  propertyId,
  filters,
  onChange,
  view,
  onChangeView,
  groupBy,
  onChangeGroupBy,
  customFields,
}: {
  propertyId: string;
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
  groupBy: BoardGroupBy;
  onChangeGroupBy: (groupBy: BoardGroupBy) => void;
  customFields: CustomFieldRow[];
}) {
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const sortModified =
    filters.sortKeys.length > 0 || filters.sortBy !== "manual";
  const modified = sortModified || (view === "board" && groupBy !== "status");
  const choiceFields = customFields.filter((f) => isChoiceField(f.type));

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title="Display options"
              className={cn(
                "ml-0.5 gap-1.5 px-2 text-muted-foreground",
                "aria-expanded:bg-accent-pressed aria-expanded:text-foreground",
                "data-popup-open:bg-accent-pressed data-popup-open:text-foreground",
              )}
            />
          }
        >
          <span className="relative inline-flex">
            <SlidersHorizontal className="size-3.5" />
            {modified ? (
              <span
                aria-hidden
                className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background"
              />
            ) : null}
          </span>
          Display
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-64 gap-0 p-0">
          <PopoverSection label="Layout">
            <div
              role="radiogroup"
              aria-label="Layout"
              className="grid grid-cols-4 gap-1 px-0.5 pb-0.5"
            >
              {VIEW_TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={view === id}
                  onClick={() => onChangeView(id)}
                  className={cn(
                    "flex h-12 flex-col items-center justify-center gap-1 rounded-md text-xs transition-colors",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    view === id
                      ? "bg-accent text-foreground"
                      : "text-secondary-ink",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </PopoverSection>

          {view === "board" ? (
            <PopoverSection label="Grouping">
              {(["status", "space", "project"] as const).map((g) => (
                <PopoverRow
                  key={g}
                  onClick={() => onChangeGroupBy(g)}
                  selected={g === groupBy}
                >
                  <span className="flex-1">{GROUP_LABELS[g]}</span>
                </PopoverRow>
              ))}
              {/* Choice custom fields group too (ClickUp's group-by-dropdown/
                  label) — a column per option, None last. */}
              {choiceFields.map((f) => {
                const id = `field:${f.id}` as const;
                return (
                  <PopoverRow
                    key={f.id}
                    onClick={() => onChangeGroupBy(id)}
                    selected={id === groupBy}
                  >
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  </PopoverRow>
                );
              })}
            </PopoverSection>
          ) : null}

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

          <PopoverSection label="Fields">
            <PopoverRow onClick={() => setFieldsOpen(true)} selected={false}>
              <span className="flex-1">Manage custom fields…</span>
            </PopoverRow>
          </PopoverSection>
        </PopoverContent>
      </Popover>
      {fieldsOpen ? (
        <CustomFieldManagerDialog
          propertyId={propertyId}
          open={fieldsOpen}
          onOpenChange={setFieldsOpen}
        />
      ) : null}
    </>
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
