"use client";

import { useCallback, useRef, useState, useTransition, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useThreads } from "@liveblocks/react/suspense";
import { Composer, Thread } from "@liveblocks/react-ui";
import "@liveblocks/react-ui/styles.css";
import {
  BellOff,
  CalendarPlus,
  ChevronDown,
  ClipboardCopy,
  FileText,
  Flag,
  History,
  Link2,
  Paperclip,
  Plus,
  Smile,
  SquarePlus,
  Star,
  Tag,
  Trash2,
  UserRound,
} from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { deleteTask, updateTask } from "./actions";
import { COLUMNS, PRIORITY_META, PRIORITY_MENU_ORDER } from "./kanban";
import { NoPriorityGlyph, PriorityBars, StatusIcon } from "./task-icons";
import { PresenceBar } from "./presence-bar";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { useAssigneesMap } from "@/lib/tasks/use-assignees";
import { taskHref } from "@/lib/tasks/task-href";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  dueAt: string | null;
  createdAt?: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatRelative(iso: string) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatDueLabel(iso: string | null) {
  if (!iso) return "Due date";
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(d);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (dueDay.getTime() - today.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays === -1) return "Due yesterday";
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function toDateInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToIso(value: string) {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function TaskDetail({
  propertyId,
  task,
}: {
  propertyId: string;
  task: Task;
}) {
  const qc = useQueryClient();
  const { threads } = useThreads();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assigneeId);
  const [dueAt, setDueAt] = useState<string | null>(task.dueAt);
  const [favorited, setFavorited] = useState(false);
  const [pending, startTransition] = useTransition();
  const savedTitle = useRef(task.title);
  const savedDescription = useRef(task.description ?? "");

  const assignees = useAssigneesMap([assigneeId]);
  const assignee = assigneeId ? assignees[assigneeId] : undefined;

  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }, [qc, propertyId]);

  function persist(
    patch: Parameters<typeof updateTask>[0],
    onOk?: () => void,
  ) {
    startTransition(async () => {
      const result = await updateTask(patch);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      invalidate();
      onOk?.();
    });
  }

  function saveTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === savedTitle.current) return;
    persist({ taskId: task.id, title: trimmed }, () => {
      savedTitle.current = trimmed;
    });
  }

  function saveDescription() {
    const next = description.trim();
    if (next === savedDescription.current) return;
    persist(
      { taskId: task.id, description: next || null },
      () => {
        savedDescription.current = next;
      },
    );
  }

  function saveStatus(next: TaskStatus) {
    setStatus(next);
    persist({ taskId: task.id, status: next });
  }

  function savePriority(next: TaskPriority) {
    setPriority(next);
    persist({ taskId: task.id, priority: next });
  }

  function saveAssignee(next: string | null) {
    setAssigneeId(next);
    persist({ taskId: task.id, assigneeId: next });
  }

  function saveDueAt(next: string | null) {
    setDueAt(next);
    persist({ taskId: task.id, dueAt: next });
  }

  function copyTaskLink() {
    const url =
      typeof window !== "undefined"
        ? window.location.href
        : taskHref(propertyId, task.id);
    void navigator.clipboard.writeText(url);
    toast.success("Link copied");
  }

  function copyTitle() {
    void navigator.clipboard.writeText(title.trim() || task.title);
    toast.success("Title copied");
  }

  function removeTask() {
    if (!window.confirm("Delete this task? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Task deleted");
      invalidate();
      window.history.pushState(null, "", `/p/${propertyId}/tasks`);
    });
  }

  function soon(label: string) {
    toast.message(`${label} — coming soon`);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Main — title, description, activity (Linear layout). */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-10 pt-8 pb-6">
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              rows={1}
              aria-label="Task title"
              disabled={pending}
              className={cn(
                "w-full resize-none border-0 bg-transparent p-0",
                "text-[1.375rem] font-semibold leading-[1.35] tracking-tight text-foreground",
                "focus-visible:outline-none",
              )}
            />

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              placeholder="Add description…"
              aria-label="Task description"
              disabled={pending}
              rows={3}
              className={cn(
                "mt-3 w-full resize-none border-0 bg-transparent p-0",
                "text-[0.875rem] leading-relaxed text-foreground",
                "placeholder:text-muted-foreground/70",
                "focus-visible:outline-none",
              )}
            />

            <div className="mt-4 flex items-center gap-1">
              <IconGhostButton label="Add reaction">
                <Smile className="size-4" />
              </IconGhostButton>
              <IconGhostButton label="Attach file">
                <Paperclip className="size-4" />
              </IconGhostButton>
            </div>

            <button
              type="button"
              className="mt-5 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add sub-issues
            </button>

            <section className="mt-10 border-t border-border/60 pt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-[0.8125rem] font-medium text-foreground">
                  Activity
                </h2>
                <PresenceBar />
              </div>

              {task.createdAt ? (
                <div className="mb-4 flex items-start gap-2.5 text-[0.8125rem]">
                  <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] font-medium text-muted-foreground">
                    ·
                  </span>
                  <p className="text-muted-foreground">
                    <span className="text-foreground/90">Task created</span>
                    {" · "}
                    {formatRelative(task.createdAt)}
                  </p>
                </div>
              ) : null}

              <div className="space-y-3">
                {threads.map((thread) => (
                  <Thread key={thread.id} thread={thread} />
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-border/60 bg-muted/15 p-1">
                <Composer metadata={{ taskId: task.id }} />
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Sidebar — Linear menu items surfaced as labeled rows, not a hidden ⋯ menu. */}
      <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border/60">
        <SidebarSection title="Properties">
          <StatusPicker status={status} onSelect={saveStatus} />
          <PriorityPicker priority={priority} onSelect={savePriority} />
          <AssigneePicker
            assignee={assignee}
            assigneeId={assigneeId}
            members={members}
            onSelect={saveAssignee}
          />
          <DueDatePicker dueAt={dueAt} onChange={saveDueAt} />
          <SidebarActionRow
            icon={<Tag className="size-3.5" />}
            label="Add label"
            muted
            onClick={() => soon("Labels")}
          />
          <SidebarActionRow
            icon={
              <span className="inline-flex size-3.5 items-center justify-center rounded-full border border-muted-foreground/50" />
            }
            label="Add to project"
            muted
            onClick={() => soon("Projects")}
          />
        </SidebarSection>

        <SidebarSection title="Links & attachments">
          <SidebarActionRow
            icon={<Link2 className="size-3.5" />}
            label="Add link"
            onClick={copyTaskLink}
          />
          <SidebarActionRow
            icon={<FileText className="size-3.5" />}
            label="Add document"
            muted
            onClick={() => soon("Documents")}
          />
          <SidebarActionRow
            icon={<Paperclip className="size-3.5" />}
            label="Attach file"
            muted
            onClick={() => soon("Attachments")}
          />
        </SidebarSection>

        <SidebarSection title="Relations">
          <SidebarActionRow
            icon={<SquarePlus className="size-3.5" />}
            label="Create related"
            muted
            onClick={() => soon("Related tasks")}
          />
          <SidebarActionRow
            icon={<Plus className="size-3.5" />}
            label="Add sub-issues"
            muted
            onClick={() => soon("Sub-issues")}
          />
          <MarkAsPicker status={status} onSelect={saveStatus} />
        </SidebarSection>

        <SidebarSection title="Actions">
          <SidebarActionRow
            icon={<ClipboardCopy className="size-3.5" />}
            label="Copy title"
            onClick={copyTitle}
          />
          <SidebarActionRow
            icon={<Link2 className="size-3.5" />}
            label="Copy link"
            onClick={copyTaskLink}
          />
          <SidebarActionRow
            icon={
              <Star
                className={cn(
                  "size-3.5",
                  favorited && "fill-amber-400 text-amber-400",
                )}
              />
            }
            label={favorited ? "Favorited" : "Favorite"}
            onClick={() => {
              setFavorited((v) => {
                toast.success(v ? "Removed from favorites" : "Favorited");
                return !v;
              });
            }}
          />
          <SidebarActionRow
            icon={<CalendarPlus className="size-3.5" />}
            label="Remind me"
            muted
            onClick={() => soon("Reminders")}
          />
          <SidebarActionRow
            icon={<BellOff className="size-3.5" />}
            label="Unsubscribe"
            onClick={() => toast.success("Unsubscribed from updates")}
          />
        </SidebarSection>

        <SidebarSection title="More">
          <SidebarActionRow
            icon={<History className="size-3.5" />}
            label="Show description history"
            muted
            onClick={() => soon("Description history")}
          />
          <SidebarActionRow
            icon={<Trash2 className="size-3.5" />}
            label="Delete"
            destructive
            onClick={removeTask}
          />
        </SidebarSection>
      </aside>
    </div>
  );
}

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border/60 py-1.5">
      <div className="flex items-center gap-1 px-3 py-1.5 text-[0.75rem] font-medium text-muted-foreground">
        <ChevronDown className="size-3.5 opacity-70" />
        {title}
      </div>
      <div className="flex flex-col gap-px px-1 pb-1">{children}</div>
    </div>
  );
}

function SidebarPropertyRow({
  icon,
  label,
  muted,
}: {
  icon: ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem]",
        muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function SidebarActionRow({
  icon,
  label,
  muted,
  destructive,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  muted?: boolean;
  destructive?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] transition-colors",
        "hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:outline-none",
        destructive
          ? "text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
          : muted
            ? "text-muted-foreground hover:text-foreground"
            : "text-foreground",
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function StatusPicker({
  status,
  onSelect,
}: {
  status: TaskStatus;
  onSelect: (status: TaskStatus) => void;
}) {
  const label =
    COLUMNS.find((c) => c.id === status)?.label ?? status.replace("_", " ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] text-foreground transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none"
          >
            <SidebarPropertyRow
              icon={<StatusIcon status={status} className="size-3.5" />}
              label={label}
            />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
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
    </DropdownMenu>
  );
}

function PriorityPicker({
  priority,
  onSelect,
}: {
  priority: TaskPriority;
  onSelect: (priority: TaskPriority) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full rounded-md transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none"
          >
            <SidebarPropertyRow
              icon={
                priority === "none" ? (
                  <NoPriorityGlyph variant="inline" />
                ) : (
                  <PriorityBars priority={priority} />
                )
              }
              label={
                priority === "none"
                  ? "Set priority"
                  : PRIORITY_META[priority].label
              }
              muted={priority === "none"}
            />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56 p-1">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[0.75rem] text-muted-foreground">
          <span>Set priority to&hellip;</span>
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-muted/60 px-1 font-sans text-[0.6875rem]">
            P
          </kbd>
        </div>
        {PRIORITY_MENU_ORDER.map((p) => (
          <DropdownMenuItem
            key={p}
            onClick={() => onSelect(p)}
            className="cursor-pointer gap-2 py-1.5"
          >
            <span className="flex w-4 items-center justify-center">
              <PriorityBars priority={p} />
            </span>
            <span className="flex-1 text-[0.8125rem]">
              {PRIORITY_META[p].label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssigneePicker({
  assignee,
  assigneeId,
  members,
  onSelect,
}: {
  assignee: { name: string; avatar?: string } | undefined;
  assigneeId: string | null;
  members: { id: string; name: string | null; avatarUrl: string | null }[];
  onSelect: (id: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full rounded-md transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none"
          >
            <SidebarPropertyRow
              icon={
                assignee ? (
                  <Avatar size="sm" className="size-4">
                    {assignee.avatar ? (
                      <AvatarImage src={assignee.avatar} alt={assignee.name} />
                    ) : null}
                    <AvatarFallback className="bg-muted text-[0.5rem]">
                      {initials(assignee.name)}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <UserRound className="size-3.5" />
                )
              }
              label={assignee?.name ?? "Assign"}
              muted={!assigneeId}
            />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-y-auto">
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
    </DropdownMenu>
  );
}

function DueDatePicker({
  dueAt,
  onChange,
}: {
  dueAt: string | null;
  onChange: (iso: string | null) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex w-full rounded-md transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none"
          >
            <SidebarPropertyRow
              icon={<CalendarPlus className="size-3.5" />}
              label={formatDueLabel(dueAt)}
              muted={!dueAt}
            />
          </button>
        }
      />
      <PopoverContent align="end" className="w-56 p-3">
        <label className="text-[0.75rem] font-medium text-muted-foreground">
          Due date
        </label>
        <input
          type="date"
          value={toDateInputValue(dueAt)}
          onChange={(e) => onChange(dateInputToIso(e.target.value))}
          className={cn(
            "mt-2 h-8 w-full rounded-md border border-input bg-transparent px-2 text-[0.8125rem]",
            "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
          )}
        />
        {dueAt ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="mt-2 text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear due date
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function MarkAsPicker({
  status,
  onSelect,
}: {
  status: TaskStatus;
  onSelect: (status: TaskStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full rounded-md transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none"
          >
            <SidebarPropertyRow
              icon={<Flag className="size-3.5" />}
              label="Mark as"
              muted
            />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        {COLUMNS.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="gap-2"
            disabled={c.id === status}
          >
            <StatusIcon status={c.id} className="size-3.5" />
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IconGhostButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
    >
      {children}
    </button>
  );
}
