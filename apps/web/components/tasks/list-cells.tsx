"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LABEL_CHIP, LABEL_DOT } from "@/components/labels/label-tokens";
import { labelsQueryOptions } from "@/lib/query/label-queries";
import type { CustomFieldValue, EntityColor, TaskStatus } from "@/lib/db/types";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { PropertyMember } from "@/lib/query/section-queries";
import type { ResolvedColumn } from "@/lib/tasks/list-columns";
import { COLUMNS, PRIORITY_IDS, PRIORITY_META, type Task } from "./kanban";
import { PriorityBars, StatusIcon } from "./task-icons";
import { CustomFieldValueEditor } from "./custom-field-value-editor";
import { addTaskLabel, removeTaskLabel } from "./task-detail-actions";
import { updateTask } from "./actions";
import { setTaskFieldValue } from "./field-actions";

/**
 * The cells of the tasks list view. Every editable cell writes through the
 * SAME server actions the task detail page uses — `updateTask` (whose DB
 * triggers emit the task.* workflow events) and `setTaskFieldValue` (whose
 * trigger emits `task.field_changed`). So editing a label in the table fires
 * exactly the automations that editing it on the task would.
 */

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function formatDate(iso: string, now: number) {
  const d = new Date(iso);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: day.getFullYear() === today.getFullYear() ? undefined : "2-digit",
  });
}

/** Everything a cell needs that isn't on the task row. */
export type CellContext = {
  propertyId: string;
  now: number;
  assignees: Record<string, AssigneeInfo>;
  members: PropertyMember[];
  spaceName: (id: string | null | undefined) => string;
  spaceColor: (id: string | null | undefined) => EntityColor | null;
  fieldValue: (taskId: string, fieldId: string) => CustomFieldValue | null;
  /** Re-fetch after a write. */
  onChanged: () => void;
};

const EMPTY = <span className="text-faint-foreground">—</span>;

export function ListCell({
  column,
  task,
  ctx,
  disabled,
}: {
  column: ResolvedColumn;
  task: Task;
  ctx: CellContext;
  disabled?: boolean;
}) {
  if (column.field) {
    return (
      <CustomFieldValueEditor
        field={column.field}
        value={ctx.fieldValue(task.id, column.field.id)}
        disabled={disabled}
        align="start"
        placeholder="—"
        singleLine
        onSave={async (value) => {
          const res = await setTaskFieldValue({
            propertyId: ctx.propertyId,
            taskId: task.id,
            fieldId: column.field!.id,
            value,
          });
          if ("error" in res) toast.error(res.error);
          ctx.onChanged();
        }}
      />
    );
  }

  switch (column.id) {
    case "status":
      return <StatusCell task={task} ctx={ctx} disabled={disabled} />;
    case "priority":
      return <PriorityCell task={task} ctx={ctx} disabled={disabled} />;
    case "due":
      return <DueCell task={task} ctx={ctx} disabled={disabled} />;
    case "assignee":
      return <AssigneeCell task={task} ctx={ctx} disabled={disabled} />;
    case "labels":
      return <TagsCell task={task} ctx={ctx} disabled={disabled} />;
    case "project":
      return (
        <span className="truncate text-sm text-muted-foreground">
          {task.project_name || EMPTY}
        </span>
      );
    case "space": {
      const name = ctx.spaceName(task.space_id);
      const color = ctx.spaceColor(task.space_id);
      if (!name) return EMPTY;
      return (
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          {color ? (
            <span className={cn("size-2 shrink-0 rounded-full", LABEL_DOT[color])} />
          ) : null}
          <span className="truncate">{name}</span>
        </span>
      );
    }
    case "created":
      return (
        <span className="text-sm tabular-nums text-muted-foreground">
          {task.created_at ? formatDate(task.created_at, ctx.now) : EMPTY}
        </span>
      );
    case "updated":
      return (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDate(task.updated_at, ctx.now)}
        </span>
      );
    default:
      return EMPTY;
  }
}

/* ── Built-in editable cells ─────────────────────────────────────────────── */

function StatusCell({
  task,
  ctx,
  disabled,
}: {
  task: Task;
  ctx: CellContext;
  disabled?: boolean;
}) {
  const col = COLUMNS.find((c) => c.id === task.status)!;
  async function set(status: TaskStatus) {
    if (status === task.status) return;
    const res = await updateTask({ taskId: task.id, status });
    if ("error" in res) toast.error(res.error);
    ctx.onChanged();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
          />
        }
      >
        <StatusIcon status={task.status} className="size-3.5 shrink-0" />
        <span className="truncate">{col.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {COLUMNS.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => void set(c.id)}>
            <StatusIcon status={c.id} className="size-3.5" />
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityCell({
  task,
  ctx,
  disabled,
}: {
  task: Task;
  ctx: CellContext;
  disabled?: boolean;
}) {
  const meta = PRIORITY_META[task.priority];
  async function set(priority: Task["priority"]) {
    if (priority === task.priority) return;
    const res = await updateTask({ taskId: task.id, priority });
    if ("error" in res) toast.error(res.error);
    ctx.onChanged();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm font-medium transition-colors hover:bg-accent",
              meta.textClass,
            )}
          />
        }
      >
        <PriorityBars priority={task.priority} />
        <span className="truncate">{meta.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PRIORITY_IDS.map((p) => (
          <DropdownMenuItem key={p} onClick={() => void set(p)}>
            <PriorityBars priority={p} />
            {PRIORITY_META[p].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Due date. Shows the friendly "Today / Tomorrow" reading until you click,
 * then swaps in a native date input — a native picker can't render those
 * words, and losing them would make the column much harder to scan.
 */
function DueCell({
  task,
  ctx,
  disabled,
}: {
  task: Task;
  ctx: CellContext;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const due = task.due_at ? new Date(task.due_at) : null;
  const overdue =
    due != null && task.status !== "done" && due.getTime() < ctx.now;

  async function set(value: string) {
    setEditing(false);
    const iso = value ? new Date(`${value}T12:00:00`).toISOString() : null;
    const res = await updateTask({ taskId: task.id, dueAt: iso });
    if ("error" in res) toast.error(res.error);
    ctx.onChanged();
  }

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={due ? due.toISOString().slice(0, 10) : ""}
        onBlur={(e) => void set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full rounded-md bg-accent px-1.5 py-0.5 text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditing(true)}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm tabular-nums transition-colors hover:bg-accent",
        due ? (overdue ? "text-destructive" : "text-muted-foreground") : "text-faint-foreground",
      )}
    >
      {due ? (
        <>
          <CalendarDays className="size-3.5 shrink-0" />
          {formatDate(task.due_at!, ctx.now)}
        </>
      ) : (
        "—"
      )}
    </button>
  );
}

function AssigneeCell({
  task,
  ctx,
  disabled,
}: {
  task: Task;
  ctx: CellContext;
  disabled?: boolean;
}) {
  const assignee = task.assignee_id ? ctx.assignees[task.assignee_id] : undefined;

  async function set(assigneeId: string | null) {
    if (assigneeId === (task.assignee_id ?? null)) return;
    const res = await updateTask({ taskId: task.id, assigneeId });
    if ("error" in res) toast.error(res.error);
    ctx.onChanged();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
          />
        }
      >
        {task.assignee_id ? (
          <>
            <Avatar size="sm" className="size-5">
              {assignee?.avatar ? (
                <AvatarImage src={assignee.avatar} alt={assignee.name} />
              ) : null}
              <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
                {initials(assignee?.name ?? "??")}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{assignee?.name ?? "—"}</span>
          </>
        ) : (
          <span className="text-faint-foreground">Unassigned</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {ctx.members.map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => void set(m.id)}>
            <Avatar size="sm" className="size-5">
              {m.avatarUrl ? (
                <AvatarImage src={m.avatarUrl} alt={m.name ?? ""} />
              ) : null}
              <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
                {initials(m.name ?? "?")}
              </AvatarFallback>
            </Avatar>
            {m.name ?? "Unknown"}
          </DropdownMenuItem>
        ))}
        {task.assignee_id ? (
          <DropdownMenuItem
            onClick={() => void set(null)}
            className="text-muted-foreground"
          >
            <X className="size-3.5" />
            Unassign
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The property-wide TAG catalog on a task (`tasks.labels`, shared with docs,
 * projects and teams) — ClickUp's Tags, as opposed to a `multi_select` custom
 * field, which carries its own private option list. Writes go through
 * `addTaskLabel` so the catalog row (and therefore the colour) is upserted.
 */
function TagsCell({
  task,
  ctx,
  disabled,
}: {
  task: Task;
  ctx: CellContext;
  disabled?: boolean;
}) {
  const { data: catalog = [] } = useQuery(labelsQueryOptions(ctx.propertyId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useMemo(() => task.labels ?? [], [task.labels]);

  const colorOf = useMemo(() => {
    const map = new Map(catalog.map((l) => [l.name.toLowerCase(), l.color]));
    return (name: string): EntityColor => map.get(name.toLowerCase()) ?? "slate";
  }, [catalog]);

  const options = useMemo(() => {
    const seen = new Set(current.map((c) => c.toLowerCase()));
    const rest = catalog
      .map((l) => l.name)
      .filter((n) => !seen.has(n.toLowerCase()));
    return [...current, ...rest];
  }, [catalog, current]);

  async function toggle(name: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = current.includes(name)
        ? await removeTaskLabel(task.id, name)
        : await addTaskLabel({ taskId: task.id, label: name });
      if ("error" in res) toast.error(res.error);
      ctx.onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addDraft() {
    const name = draft.trim();
    if (!name || busy) return;
    setDraft("");
    await toggle(name);
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className="flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-accent"
          />
        }
      >
        {current.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-sm text-faint-foreground">
            <Plus className="size-3" />
            Add
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            {current.map((name) => (
              <span
                key={name}
                className={cn(
                  "inline-flex h-5 shrink-0 items-center rounded-pill px-1.5 text-xs font-medium whitespace-nowrap",
                  LABEL_CHIP[colorOf(name)],
                )}
              >
                {name}
              </span>
            ))}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-2 text-center text-xs text-muted-foreground">
              No tags in this property yet.
            </p>
          ) : (
            options.map((name) => {
              const on = current.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={busy}
                  onClick={() => void toggle(name)}
                  aria-pressed={on}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      LABEL_DOT[colorOf(name)],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {name}
                  </span>
                  {on ? (
                    <Check className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <div className="mt-1 border-t border-border pt-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addDraft();
              }
            }}
            placeholder="New tag…"
            maxLength={40}
            className="h-7 text-xs"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
