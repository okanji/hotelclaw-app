"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  FileText,
  Flag,
  History,
  Link2,
  Paperclip,
  Plus,
  SquarePlus,
  Star,
  Tag,
  Trash2,
  UserRound,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { COLUMNS, PRIORITY_META, PRIORITY_MENU_ORDER } from "./kanban";
import { NoPriorityGlyph, PriorityBars, StatusIcon } from "./task-icons";
import { TaskProjectSpacePicker } from "./task-project-space-picker";
import { labelsQueryOptions } from "@/lib/query/label-queries";
import type { EntityColor } from "@/lib/db/types";

/** Catalog accent dots for label chips. */
const LABEL_DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};
import { taskDetailMetaQueryOptions } from "@/lib/query/section-queries";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import { taskHref } from "@/lib/tasks/task-href";
import type {
  TaskDetailOpeners,
  TaskDetailRemovers,
} from "./task-detail-mutations";
import type { TaskDetailMeta } from "@/lib/tasks/task-detail-meta";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

type Member = { id: string; name: string | null; avatarUrl: string | null };

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
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
  return new Date(iso).toLocaleDateString();
}

export function TaskDetailSidebar({
  propertyId,
  taskId,
  status,
  priority,
  assigneeId,
  assignee,
  dueAt,
  members,
  meta,
  openers,
  removers,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDueAtChange,
  onCopyTitle,
  onCopyLink,
  onDelete,
  onAddSubIssue,
  onAutomate,
}: {
  propertyId: string;
  taskId: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assignee: { name: string; avatar?: string } | undefined;
  dueAt: string | null;
  members: Member[];
  meta: TaskDetailMeta | undefined;
  openers: TaskDetailOpeners;
  removers: TaskDetailRemovers;
  onStatusChange: (s: TaskStatus) => void;
  onPriorityChange: (p: TaskPriority) => void;
  onAssigneeChange: (id: string | null) => void;
  onDueAtChange: (iso: string | null) => void;
  onCopyTitle: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onAddSubIssue: () => void;
  onAutomate: () => void;
}) {
  const { data: labelCatalog = [] } = useQuery(labelsQueryOptions(propertyId));
  const labelColor = (name: string): EntityColor =>
    labelCatalog.find((l) => l.name.toLowerCase() === name.toLowerCase())
      ?.color ?? "slate";
  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border/60">
      <SidebarSection title="Properties" defaultOpen>
        <StatusPicker status={status} onSelect={onStatusChange} />
        <PriorityPicker priority={priority} onSelect={onPriorityChange} />
        <AssigneePicker
          assignee={assignee}
          assigneeId={assigneeId}
          members={members}
          onSelect={onAssigneeChange}
        />
        <DueDatePicker dueAt={dueAt} onChange={onDueAtChange} />
        <TaskProjectSpacePicker propertyId={propertyId} taskId={taskId} />
        {(meta?.labels ?? []).map((label) => (
          <MetaChipRow
            key={label}
            icon={
              <span
                className={cn(
                  "size-2.5 rounded-full",
                  LABEL_DOT[labelColor(label)],
                )}
              />
            }
            label={label}
            onRemove={() => removers.removeLabel(label)}
          />
        ))}
        <SidebarActionRow
          icon={<Tag className="size-3.5" />}
          label="Add label"
          muted={!(meta?.labels.length ?? 0)}
          onClick={openers.addLabel}
        />
      </SidebarSection>

      <SidebarSection title="Links & attachments" defaultOpen>
        {(meta?.links ?? []).map((link) => (
          <LinkRow
            key={link.id}
            url={link.url}
            title={link.title}
            onRemove={() => removers.removeLink(link.id)}
          />
        ))}
        {(meta?.documents ?? []).map((doc) => (
          <DocumentRow
            key={doc.id}
            propertyId={propertyId}
            documentId={doc.documentId}
            title={doc.title}
            onRemove={() => removers.unlinkDocument(doc.id)}
          />
        ))}
        {(meta?.attachments ?? []).map((file) => (
          <AttachmentRow
            key={file.id}
            fileName={file.fileName}
            url={file.url}
            onRemove={() => removers.removeAttachment(file.id)}
          />
        ))}
        <SidebarActionRow
          icon={<Link2 className="size-3.5" />}
          label="Add link"
          onClick={openers.addLink}
        />
        <SidebarActionRow
          icon={<FileText className="size-3.5" />}
          label="Add document"
          onClick={openers.addDocument}
        />
        <SidebarActionRow
          icon={<Paperclip className="size-3.5" />}
          label="Attach file"
          onClick={openers.attachFile}
        />
      </SidebarSection>

      <SidebarSection title="Relations" defaultOpen>
        {(meta?.relatedTasks ?? []).map((rel) => (
          <RelatedTaskRow
            key={rel.id}
            propertyId={propertyId}
            taskId={rel.id}
            title={rel.title}
            status={rel.status as TaskStatus}
            onRemove={() => removers.removeRelation(rel.relationId)}
          />
        ))}
        <SidebarActionRow
          icon={<SquarePlus className="size-3.5" />}
          label="Create related"
          onClick={openers.createRelated}
        />
        <SidebarActionRow
          icon={<Plus className="size-3.5" />}
          label="Add sub-issues"
          onClick={onAddSubIssue}
        />
        <MarkAsPicker status={status} onSelect={onStatusChange} />
      </SidebarSection>

      <SidebarSection title="Actions" defaultOpen>
        <SidebarActionRow
          icon={<ClipboardCopy className="size-3.5" />}
          label="Copy title"
          onClick={onCopyTitle}
        />
        <SidebarActionRow
          icon={<Link2 className="size-3.5" />}
          label="Copy link"
          onClick={onCopyLink}
        />
        <SidebarActionRow
          icon={
            <Star
              className={cn(
                "size-3.5",
                meta?.favorited && "fill-amber-400 text-amber-400",
              )}
            />
          }
          label={meta?.favorited ? "Favorited" : "Favorite"}
          onClick={removers.toggleFavorite}
        />
        <SidebarActionRow
          icon={<CalendarPlus className="size-3.5" />}
          label={
            meta?.reminders.length
              ? `Remind ${formatRelative(meta.reminders[0]!.remindAt)}`
              : "Remind me"
          }
          muted={!meta?.reminders.length}
          onClick={openers.remindMe}
        />
        <SidebarActionRow
          icon={
            meta?.muted ? (
              <BellOff className="size-3.5" />
            ) : (
              <Bell className="size-3.5" />
            )
          }
          label={meta?.muted ? "Unsubscribed" : "Unsubscribe"}
          onClick={removers.toggleMute}
        />
        <SidebarActionRow
          icon={<Workflow className="size-3.5" />}
          label="Automate from this task…"
          onClick={onAutomate}
        />
      </SidebarSection>

      <TaskAutomationsSection propertyId={propertyId} />

      <SidebarSection title="More" defaultOpen={false}>
        <SidebarActionRow
          icon={<History className="size-3.5" />}
          label="Show description history"
          muted={!meta?.descriptionRevisions.length}
          onClick={openers.showHistory}
        />
        <SidebarActionRow
          icon={<Trash2 className="size-3.5" />}
          label="Delete"
          destructive
          onClick={onDelete}
        />
      </SidebarSection>
    </aside>
  );
}

function SidebarSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/60 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-[0.75rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="size-3.5 opacity-70" />
        ) : (
          <ChevronRight className="size-3.5 opacity-70" />
        )}
        {title}
      </button>
      {open ? (
        <div className="flex flex-col gap-px px-1 pb-1">{children}</div>
      ) : null}
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
      <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function MetaChipRow({
  icon,
  label,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-foreground/[0.06]">
      <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/[0.08]"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function LinkRow({
  url,
  title,
  onRemove,
}: {
  url: string;
  title: string | null;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-foreground/[0.06]">
      <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate hover:underline"
      >
        {title || url}
      </a>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open link"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/[0.08]"
      >
        <ExternalLink className="size-3" />
      </a>
      <button
        type="button"
        aria-label="Remove link"
        onClick={onRemove}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/[0.08]"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function DocumentRow({
  propertyId,
  documentId,
  title,
  onRemove,
}: {
  propertyId: string;
  documentId: string;
  title: string;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-foreground/[0.06]">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <Link
        href={`/p/${propertyId}/docs/${documentId}`}
        className="min-w-0 flex-1 truncate hover:underline"
      >
        {title}
      </Link>
      <button
        type="button"
        aria-label="Unlink document"
        onClick={onRemove}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/[0.08]"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function AttachmentRow({
  fileName,
  url,
  onRemove,
}: {
  fileName: string;
  url: string;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-foreground/[0.06]">
      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate hover:underline"
        >
          {fileName}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate">{fileName}</span>
      )}
      <button
        type="button"
        aria-label="Remove attachment"
        onClick={onRemove}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/[0.08]"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function RelatedTaskRow({
  propertyId,
  taskId,
  title,
  status,
  onRemove,
}: {
  propertyId: string;
  taskId: string;
  title: string;
  status: TaskStatus;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-foreground/[0.06]">
      <StatusIcon status={status} className="size-3.5 shrink-0" />
      <Link
        href={taskHref(propertyId, taskId)}
        className="min-w-0 flex-1 truncate hover:underline"
      >
        {title}
      </Link>
      <button
        type="button"
        aria-label="Remove relation"
        onClick={onRemove}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/[0.08]"
      >
        <X className="size-3" />
      </button>
    </div>
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
  members: Member[];
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

export function SubIssuesPanel({
  propertyId,
  taskId,
  status,
  adding,
  onStartAdd,
  onCancelAdd,
}: {
  propertyId: string;
  taskId: string;
  status: TaskStatus;
  adding: boolean;
  onStartAdd: () => void;
  onCancelAdd: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const { data: meta } = useQuery(taskDetailMetaQueryOptions(propertyId, taskId));

  function createSubIssue() {
    const trimmed = title.trim();
    if (!trimmed) {
      onCancelAdd();
      return;
    }
    startTransition(async () => {
      const { createTask } = await import("./actions");
      const result = await createTask({
        propertyId,
        title: trimmed,
        status,
        parentId: taskId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Sub-issue created");
      setTitle("");
      onCancelAdd();
      qc.invalidateQueries({ queryKey: ["task-meta", propertyId, taskId] });
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    });
  }

  const subIssues = meta?.subIssues ?? [];

  return (
    <div className="mt-5">
      {subIssues.length > 0 ? (
        <ul className="mb-2 space-y-0.5">
          {subIssues.map((sub) => (
            <li key={sub.id}>
              <Link
                href={taskHref(propertyId, sub.id)}
                className="flex items-center gap-2 rounded-md px-1 py-1.5 text-[0.8125rem] transition-colors hover:bg-foreground/[0.06]"
              >
                <StatusIcon status={sub.status as TaskStatus} className="size-3.5" />
                <span className="truncate">{sub.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="rounded-md border border-border/60 bg-muted/10 p-2">
          <Input
            autoFocus
            placeholder="Sub-issue title"
            value={title}
            disabled={pending}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createSubIssue();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelAdd();
              }
            }}
            onBlur={() => {
              if (!title.trim()) onCancelAdd();
            }}
            className="h-8 border-0 bg-transparent px-1 text-[0.8125rem] shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[0.75rem]"
              onClick={onCancelAdd}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-[0.75rem]"
              disabled={pending || !title.trim()}
              onClick={createSubIssue}
            >
              Add
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStartAdd}
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add sub-issues
        </button>
      )}
    </div>
  );
}

/**
 * "Automations" — workflows on this property whose trigger listens to task
 * events. Answers "what will fire when I change this task?" right where the
 * user is looking; each row deep-links to the workflow. Hidden entirely when
 * no task-triggered workflows exist (the Automate row above covers creation).
 */
function TaskAutomationsSection({ propertyId }: { propertyId: string }) {
  const { data: workflows = [] } = useQuery(workflowsListQueryOptions(propertyId));
  const applicable = workflows.filter((w) =>
    w.trigger_event_type?.startsWith("task."),
  );
  if (applicable.length === 0) return null;

  return (
    <SidebarSection title="Automations">
      {applicable.slice(0, 6).map((w) => (
        <Link
          key={w.id}
          href={`/p/${propertyId}/workflows/${w.id}`}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[0.8125rem] text-foreground/90 transition-colors hover:bg-foreground/[0.06]"
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              w.enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
            title={w.enabled ? "On" : "Off"}
            aria-label={w.enabled ? "On" : "Off"}
          />
          <span className="min-w-0 truncate">{w.name}</span>
          <span className="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground">
            {w.trigger_event_type?.replace("task.", "on ").replace(/_/g, " ")}
          </span>
        </Link>
      ))}
    </SidebarSection>
  );
}
