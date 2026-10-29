"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  CalendarRange,
  Check,
  Columns3,
  Filter,
  List,
  Rows3,
  Search,
  SquareKanban,
  Users,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isChoiceField } from "@/lib/tasks/custom-field-options";
import { cn } from "@/lib/utils";
import { SORT_LABELS } from "./kanban";
import { TriageDial } from "./triage-dial";
import { AutomationsButton } from "@/components/workflows/automations-button";
import { CustomFieldManagerDialog } from "./custom-field-manager";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Gi } from "@/components/gr8r/icon";
import { triageCountQueryOptions } from "@/lib/query/triage-queries";
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

const VIEW_TABS: { id: ViewMode; label: string; Icon: typeof List }[] = [
  { id: "board", label: "Board", Icon: SquareKanban },
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
  const [fieldsOpen, setFieldsOpen] = useState(false);

  // `/` focuses search (Linear/GitHub convention). Skip when typing in
  // another input so we don't steal keystrokes mid-edit.
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
  const choiceFields = customFields.filter((f) => isChoiceField(f.type));

  const sortName =
    filters.sortKeys.length > 0
      ? filters.sortKeys.map((k) => SORT_LABELS[k]).join(", ")
      : SORT_LABELS[filters.sortBy];
  const groupName = groupBy.startsWith("field:")
    ? (customFields.find((f) => `field:${f.id}` === groupBy)?.name ?? "Field")
    : GROUP_LABELS[groupBy as keyof typeof GROUP_LABELS];

  return (
    // gr8r's view toolbar (src/shell/view-engine.js `viewToolbar`): search,
    // Filter, Sort, Group, Fields on the left; the status preset `.seg`, the
    // AI / automation glyphs and the layout `.seg` on the right.
    <div className="toolbar" role="toolbar" aria-label="Tasks view">
      <div className="inwrap">
        <Search className="i" size={13} strokeWidth={1.8} aria-hidden />
        <input
          ref={searchRef}
          type="search"
          name="board-search"
          className="input search-sm"
          placeholder="Search tasks"
          aria-label="Search tasks"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onChange({ ...filters, search: "" });
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      <FilterMenu
        filters={filters}
        onPick={onPickFacet}
        customFields={customFields}
      />

      {/* Sort — Manual, or a click-to-stack multi-key sort (ClickUp). */}
      <Popover>
        <PopoverTrigger
          render={<button type="button" className="btn btn-ghost" />}
        >
          <ArrowUpDown className="i" size={14} strokeWidth={1.8} aria-hidden />
          <span className="hide-m">Sort:</span> {sortName}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-56 gap-0 p-0">
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
                    <span className="badge gray num">{index + 1}</span>
                  ) : null}
                </PopoverRow>
              );
            })}
          </PopoverSection>
        </PopoverContent>
      </Popover>

      {/* Group — the board's columns: status (the list pipeline), team,
          project, or a choice custom field. The list view groups by status. */}
      {view === "board" ? (
        <Popover>
          <PopoverTrigger
            render={<button type="button" className="btn btn-ghost" />}
          >
            <Rows3 className="i" size={14} strokeWidth={1.8} aria-hidden />
            <span className="hide-m">Group:</span> {groupName}
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-56 gap-0 p-0">
            <PopoverSection label="Group by">
              {(["status", "space", "project"] as const).map((g) => (
                <PopoverRow
                  key={g}
                  onClick={() => onChangeGroupBy(g)}
                  selected={g === groupBy}
                >
                  <span className="flex-1">{GROUP_LABELS[g]}</span>
                </PopoverRow>
              ))}
            </PopoverSection>
            {choiceFields.length > 0 ? (
              <PopoverSection label="Custom fields">
                {/* ClickUp's group-by-dropdown/label — a column per option,
                    None last. */}
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
          </PopoverContent>
        </Popover>
      ) : null}

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setFieldsOpen(true)}
        title="Manage custom fields"
      >
        <Columns3 className="i" size={14} strokeWidth={1.8} aria-hidden />
        <span className="hide-m">Fields</span>
      </button>

      {/* Status preset — gr8r's "show done" toggle grown into Linear's
          All / Active / Backlog. */}
      <div className="seg" role="tablist" aria-label="Status filter">
        {STATUS_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filters.statusPreset === id}
            className={filters.statusPreset === id ? "on" : ""}
            onClick={() => onChange({ ...filters, statusPreset: id })}
          >
            {label}
          </button>
        ))}
      </div>

      <span className="sp" />

      {/* Visible / total hint — only when filters are actively narrowing. */}
      {(activeFilterCount > 0 || filters.search.length > 0) && total > 0 ? (
        <span className="faint num hide-m" style={{ fontSize: "var(--g8-fs-xs)" }}>
          {visible} of {total}
        </span>
      ) : null}

      <TriageChip propertyId={propertyId} />

      <TriageDial propertyId={propertyId} showLabel={false} />

      <AutomationsButton
        propertyId={propertyId}
        feature="tasks"
        showLabel={false}
        className="text-muted-foreground"
      />

      <div className="seg" role="tablist" aria-label="Layout">
        {VIEW_TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? "on" : ""}
            onClick={() => onChangeView(id)}
          >
            <Icon className="i" size={13} strokeWidth={1.8} aria-hidden />
            <span className="hide-m">{label}</span>
          </button>
        ))}
      </div>

      {fieldsOpen ? (
        <CustomFieldManagerDialog
          propertyId={propertyId}
          open={fieldsOpen}
          onOpenChange={setFieldsOpen}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Popover primitives                                                         */
/* -------------------------------------------------------------------------- */

export function PopoverSection({
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

export function PopoverRow({
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

/**
 * "N in triage" — Linear keeps the intake queue next to the work, not in the
 * Inbox. Only while something is waiting; the count route is full-members
 * only, so guests (403) never see it.
 */
function TriageChip({ propertyId }: { propertyId: string }) {
  const { data: count = 0 } = useQuery({
    ...triageCountQueryOptions(propertyId),
    retry: false,
  });
  if (!count) return null;
  return (
    <Link
      href={`/p/${propertyId}/triage`}
      className="pillbtn bordered hide-m"
      title="Incoming requests waiting to be accepted or declined"
    >
      <Gi icon={Filter} size={13} />
      <span className="num">{count > 99 ? "99+" : count}</span> in triage
    </Link>
  );
}
