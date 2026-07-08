"use client";

import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { PopoverContent } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { COLUMNS, PRIORITY_META, PRIORITY_MENU_ORDER } from "./kanban";
import { PriorityBars, StatusIcon } from "./task-icons";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

/**
 * Shared menu/popover CONTENT for the task property pickers. The inline
 * property chips and the detail sidebar each own their trigger chrome but
 * must render identical option lists — these were fully duplicated (down to
 * the date-input) before this module existed.
 */

export type PickerMember = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function toDateInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateInputToIso(value: string) {
  if (!value) return null;
  // Noon-anchored so the stored instant stays on the chosen day across
  // reasonable timezone offsets (matches the original picker behavior).
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function StatusMenuContent({
  align = "start",
  onSelect,
}: {
  align?: "start" | "end";
  onSelect: (status: TaskStatus) => void;
}) {
  return (
    <DropdownMenuContent align={align} className="w-48">
      {COLUMNS.map((c) => (
        <DropdownMenuItem
          key={c.id}
          onClick={() => onSelect(c.id)}
          className="gap-2"
        >
          <StatusIcon status={c.id} className="size-3.5" />
          {c.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

export function PriorityMenuContent({
  align = "start",
  onSelect,
}: {
  align?: "start" | "end";
  onSelect: (priority: TaskPriority) => void;
}) {
  return (
    <DropdownMenuContent align={align} className="w-56 p-1">
      {PRIORITY_MENU_ORDER.map((p) => (
        <DropdownMenuItem
          key={p}
          onClick={() => onSelect(p)}
          className="cursor-pointer gap-2 py-1.5"
        >
          <span className="flex w-4 items-center justify-center">
            <PriorityBars priority={p} />
          </span>
          <span className="flex-1 text-sm">{PRIORITY_META[p].label}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

export function AssigneeMenuContent({
  align = "start",
  members,
  onSelect,
}: {
  align?: "start" | "end";
  members: PickerMember[];
  onSelect: (id: string | null) => void;
}) {
  return (
    <DropdownMenuContent
      align={align}
      className="max-h-64 w-56 overflow-y-auto"
    >
      <DropdownMenuItem onClick={() => onSelect(null)}>
        Unassigned
      </DropdownMenuItem>
      {members.map((m) => (
        <DropdownMenuItem
          key={m.id}
          onClick={() => onSelect(m.id)}
          className="gap-2"
        >
          <Avatar size="sm" className="size-5">
            {m.avatarUrl ? (
              <AvatarImage src={m.avatarUrl} alt={m.name ?? "Member"} />
            ) : null}
            <AvatarFallback className="bg-muted text-[0.5625rem]">
              {initials(m.name ?? "?")}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{m.name ?? "Member"}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

export function DueDatePopoverContent({
  align = "start",
  label = "Due date",
  clearLabel = "Clear due date",
  dueAt,
  onChange,
}: {
  align?: "start" | "end";
  label?: string;
  clearLabel?: string;
  dueAt: string | null;
  onChange: (iso: string | null) => void;
}) {
  return (
    <PopoverContent align={align} className="w-56 p-3">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type="date"
        name="dueDate"
        aria-label={label}
        value={toDateInputValue(dueAt)}
        onChange={(e) => onChange(dateInputToIso(e.target.value))}
        className={cn(
          "mt-2 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm max-sm:text-base",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        )}
      />
      {dueAt ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {clearLabel}
        </button>
      ) : null}
    </PopoverContent>
  );
}
