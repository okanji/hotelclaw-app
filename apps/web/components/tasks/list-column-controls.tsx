"use client";

import { useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronsLeft,
  ChevronsRight,
  EyeOff,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CustomFieldRow } from "@/lib/query/custom-field-queries";
import { FIELD_TYPE_LABEL } from "@/lib/tasks/custom-field-options";
import {
  availableColumns,
  fieldColumnId,
  type ResolvedColumn,
} from "@/lib/tasks/list-columns";
import type { TaskViewColumn, TaskViewSort } from "@/lib/db/types";
import { CustomFieldCreateForm, TYPE_ICON } from "./custom-field-create-form";

/**
 * Column chrome for the list view: the per-column header menu and the "+"
 * add-column panel at the right end of the header row — the two controls
 * ClickUp's List view hangs its whole table configuration off.
 */

export function ColumnHeaderMenu({
  column,
  sort,
  isFirst,
  isLast,
  onSort,
  onMove,
  onHide,
  children,
}: {
  column: ResolvedColumn;
  sort: TaskViewSort;
  isFirst: boolean;
  isLast: boolean;
  onSort: (dir: "asc" | "desc" | null) => void;
  onMove: (to: "start" | "end") => void;
  onHide: () => void;
  children: React.ReactNode;
}) {
  const active = sort?.columnId === column.id ? sort.dir : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent"
          />
        }
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{column.label}</DropdownMenuLabel>
          {column.sortable ? (
            <>
              <DropdownMenuItem
                onClick={() => onSort(active === "asc" ? null : "asc")}
              >
                <ArrowDownAZ className="size-3.5" />
                {active === "asc" ? "Clear sort" : "Sort ascending"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onSort(active === "desc" ? null : "desc")}
              >
                <ArrowUpAZ className="size-3.5" />
                {active === "desc" ? "Clear sort" : "Sort descending"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem disabled={isFirst} onClick={() => onMove("start")}>
            <ChevronsLeft className="size-3.5" />
            Move to start
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onClick={() => onMove("end")}>
            <ChevronsRight className="size-3.5" />
            Move to end
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onHide}>
            <EyeOff className="size-3.5" />
            Hide column
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The "+" at the end of the header row. Two tabs, exactly like ClickUp's:
 * show a field that already exists, or create a new one — because the moment
 * you want a column is the moment you discover the field is missing.
 */
export function AddColumnButton({
  propertyId,
  stored,
  fields,
  onAdd,
}: {
  propertyId: string;
  stored: TaskViewColumn[];
  fields: CustomFieldRow[];
  onAdd: (columnId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const available = availableColumns(stored, fields);
  const nothingLeft =
    available.builtins.length === 0 && available.fields.length === 0;

  function add(id: string) {
    onAdd(id);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Land on the useful tab: nothing left to show means you're here to
        // create something.
        if (next) setTab(nothingLeft ? "new" : "existing");
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Add column"
            title="Add column"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          />
        }
      >
        <Plus className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="mb-2 flex items-center gap-1">
          <TabButton
            active={tab === "existing"}
            onClick={() => setTab("existing")}
          >
            Add existing
          </TabButton>
          <TabButton active={tab === "new"} onClick={() => setTab("new")}>
            New field
          </TabButton>
        </div>

        {tab === "existing" ? (
          nothingLeft ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Every column is already on the table.
            </p>
          ) : (
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {available.builtins.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  <p className="px-1.5 py-1 text-xs font-medium text-faint-foreground">
                    Task properties
                  </p>
                  {available.builtins.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => add(c.id)}
                      className="rounded-md px-1.5 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {available.fields.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  <p className="px-1.5 py-1 text-xs font-medium text-faint-foreground">
                    Custom fields
                  </p>
                  {available.fields.map((f) => {
                    const Icon = TYPE_ICON[f.type];
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => add(fieldColumnId(f.id))}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent"
                      >
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span className="shrink-0 text-xs text-faint-foreground">
                          {FIELD_TYPE_LABEL[f.type]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )
        ) : (
          <div className="max-h-96 overflow-y-auto p-1">
            <CustomFieldCreateForm
              propertyId={propertyId}
              taskSpaceId={null}
              submitLabel="Create and add column"
              onCreated={(fieldId) => add(fieldColumnId(fieldId))}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-accent-pressed text-foreground"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** The active-sort strip above the table — sorted means no manual dragging. */
export function SortNotice({
  label,
  dir,
  onClear,
}: {
  label: string;
  dir: "asc" | "desc";
  onClear: () => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-muted px-4 text-xs text-muted-foreground">
      {dir === "asc" ? (
        <ArrowDownAZ className="size-3.5" />
      ) : (
        <ArrowUpAZ className="size-3.5" />
      )}
      <span>
        Sorted by <span className="font-medium text-foreground">{label}</span>{" "}
        ({dir === "asc" ? "ascending" : "descending"}) — drag to reorder is off
        while sorted.
      </span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3" />
        Clear
      </button>
    </div>
  );
}
