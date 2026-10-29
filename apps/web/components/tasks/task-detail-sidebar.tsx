"use client";

import { assigneeSummary } from "@/lib/tasks/assignee-label";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  Calendar,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardCopy,
  ExternalLink,
  FileText,
  Flag,
  Hash,
  History,
  Link2,
  OctagonAlert,
  Paperclip,
  Plus,
  Repeat,
  SignalHigh,
  SquarePlus,
  Star,
  Tag,
  Trash2,
  User,
  Workflow,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { describeStatus, isDone, type ColumnDef } from "@/lib/tasks/statuses";
import { StatusIcon } from "./task-icons";
import { TaskProjectSpacePicker } from "./task-project-space-picker";
import { TaskCustomFields } from "./task-custom-fields";
import { RECURRENCE_LABEL } from "./task-detail-inline-properties";
import { TaskPlanningChips } from "@/components/cycles/task-planning-chips";
import { labelsQueryOptions } from "@/lib/query/label-queries";
import type { EntityColor } from "@/lib/db/types";
import { taskDetailMetaQueryOptions } from "@/lib/query/section-queries";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import { taskHref } from "@/lib/tasks/task-href";
import type {
  TaskDetailOpeners,
  TaskDetailRemovers,
} from "./task-detail-mutations";
import type { TaskDetailMeta } from "@/lib/tasks/task-detail-meta";
import type { TaskPriority, TaskRecurrence } from "@/lib/db/types";
import {
  AssigneeMenuContent,
  DueDatePopoverContent,
  PriorityMenuContent,
  StatusMenuContent,
  type StatusRowFields,
} from "./task-property-menus";
import { Gi } from "@/components/gr8r/icon";
import { Av, ProgBar } from "@/components/gr8r/home-glyphs";
import {
  G8PriorityIcon,
  G8StatusIcon,
  PRIORITY_NAME,
  cVar,
  g8Color,
} from "@/components/gr8r/my-tasks-glyphs";

type Member = { id: string; name: string | null; avatarUrl: string | null };

/**
 * The task's utility rail, in gr8r's vocabulary: properties as the drawer's
 * `.kv` label / value grid (`dt` icon + label, `dd` a `.pillbtn`), then
 * gr8r `.dsec`-headed groups whose rows are `.sitem`s. Docked beside the
 * task at ≥@4xl/task on the full page; a floating drawer otherwise.
 */

export function formatDueLabel(iso: string | null) {
  if (!iso) return "Set date";
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(d);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (dueDay.getTime() - today.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** True when a due date's DAY is before today. */
export function isOverdueDay(iso: string | null): boolean {
  if (!iso) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
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
  className,
  propertyId,
  taskId,
  status,
  statusOptions,
  statusRow,
  priority,
  assigneeId,
  assignee,
  assigneeIds,
  assigneeInfos,
  onAssigneesChange,
  dueAt,
  members,
  meta,
  openers,
  removers,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDueAtChange,
  recurrence = null,
  onRecurrenceChange,
  onCopyTitle,
  onCopyId,
  onCopyLink,
  onDelete,
  onEscalate,
  onAddSubIssue,
  onAutomate,
}: {
  /** Extra classes for the aside — the artifact panel repositions it as an overlay drawer. */
  className?: string;
  propertyId: string;
  taskId: string;
  /** A status id or a legacy literal — whatever `updateTask({status})` takes. */
  status: string;
  /** The task's list pipeline (0114); omit for the four category columns. */
  statusOptions?: ColumnDef[];
  statusRow?: StatusRowFields;
  priority: TaskPriority;
  assigneeId: string | null;
  assignee: { name: string; avatar?: string } | undefined;
  /** Multi-assignee (0115): when given, the picker ticks people in and out. */
  assigneeIds?: string[];
  assigneeInfos?: Record<string, { name: string; avatar?: string }>;
  onAssigneesChange?: (ids: string[]) => void;
  dueAt: string | null;
  members: Member[];
  meta: TaskDetailMeta | undefined;
  openers: TaskDetailOpeners;
  removers: TaskDetailRemovers;
  onStatusChange: (s: string) => void;
  onPriorityChange: (p: TaskPriority) => void;
  onAssigneeChange: (id: string | null) => void;
  onDueAtChange: (iso: string | null) => void;
  /** Repeat cadence (migration 0107). Omit the handler to hide the row. */
  recurrence?: TaskRecurrence | null;
  onRecurrenceChange?: (r: TaskRecurrence | null) => void;
  onCopyTitle: () => void;
  /** Copies the short task key (`taskShortId`). Omit to hide the row. */
  onCopyId?: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onEscalate: () => void;
  onAddSubIssue: () => void;
  onAutomate: () => void;
}) {
  const { data: labelCatalog = [] } = useQuery(labelsQueryOptions(propertyId));
  const labelColor = (name: string): EntityColor =>
    labelCatalog.find((l) => l.name.toLowerCase() === name.toLowerCase())
      ?.color ?? "slate";
  const labels = meta?.labels ?? [];
  return (
    <aside
      className={cn(
        "g8-trail flex w-[300px] shrink-0 flex-col overflow-y-auto",
        className,
      )}
      aria-label="Task details"
    >
      <RailSection title="Properties" defaultOpen>
        <dl className="kv g8-trail-kv">
          <StatusPicker
            status={status}
            options={statusOptions}
            row={statusRow}
            onSelect={onStatusChange}
          />
          <PriorityPicker priority={priority} onSelect={onPriorityChange} />
          <AssigneePicker
            assignee={assignee}
            assigneeId={assigneeId}
            members={members}
            onSelect={onAssigneeChange}
            assigneeIds={assigneeIds}
            assigneeInfos={assigneeInfos}
            onAssigneesChange={onAssigneesChange}
          />
          <DueDatePicker dueAt={dueAt} onChange={onDueAtChange} />
          {onRecurrenceChange ? (
            <RecurrencePicker
              recurrence={recurrence}
              onSelect={onRecurrenceChange}
            />
          ) : null}
          <dt>
            <Gi icon={Tag} size={14} />
            Labels
          </dt>
          <dd>
            {labels.map((label) => (
              <LabelChip
                key={label}
                label={label}
                color={labelColor(label)}
                onRemove={() => removers.removeLabel(label)}
              />
            ))}
            <button
              type="button"
              className="pillbtn empty"
              onClick={openers.addLabel}
              aria-label="Add label"
            >
              {labels.length ? <Gi icon={Plus} size={13} /> : <><Gi icon={Tag} size={13} />Add labels</>}
            </button>
          </dd>
        </dl>
        {/* Project / team / list, then Estimate / Cycle / Milestone (0111) —
            full-width rows (the milestone choices come from the project). */}
        <div className="g8-trail-rows">
          <TaskProjectSpacePicker propertyId={propertyId} taskId={taskId} />
          <TaskPlanningChips
            propertyId={propertyId}
            taskId={taskId}
            variant="row"
          />
        </div>
      </RailSection>

      <RailSection title="Fields" defaultOpen>
        <TaskCustomFields propertyId={propertyId} taskId={taskId} />
      </RailSection>

      <RailSection title="Links & attachments" defaultOpen>
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
        {/* Slot files (0116) render in their Files field, not here. */}
        {(meta?.attachments ?? []).filter((f) => !f.fieldId).map((file) => (
          <AttachmentRow
            key={file.id}
            fileName={file.fileName}
            url={file.url}
            onRemove={() => removers.removeAttachment(file.id)}
          />
        ))}
        <ActionRow icon={Link2} label="Add link" onClick={openers.addLink} />
        <ActionRow
          icon={FileText}
          label="Add document"
          onClick={openers.addDocument}
        />
        <ActionRow
          icon={Paperclip}
          label="Attach file"
          onClick={openers.attachFile}
        />
      </RailSection>

      <RailSection title="Relations" defaultOpen>
        {(meta?.relatedTasks ?? []).map((rel) => (
          <RelatedTaskRow
            key={rel.id}
            propertyId={propertyId}
            taskId={rel.id}
            title={rel.title}
            status={rel.status}
            relation={rel.relation}
            onRemove={() => removers.removeRelation(rel.relationId)}
          />
        ))}
        <ActionRow
          icon={SquarePlus}
          label="Create related"
          onClick={openers.createRelated}
        />
        <ActionRow icon={Plus} label="Add sub-issues" onClick={onAddSubIssue} />
        <MarkAsPicker
          status={status}
          options={statusOptions}
          onSelect={onStatusChange}
        />
      </RailSection>

      <RailSection title="Actions" defaultOpen>
        <ActionRow icon={ClipboardCopy} label="Copy title" onClick={onCopyTitle} />
        {onCopyId ? (
          <ActionRow icon={Hash} label="Copy ID" onClick={onCopyId} />
        ) : null}
        <ActionRow icon={Link2} label="Copy link" onClick={onCopyLink} />
        <ActionRow
          icon={Star}
          label={meta?.favorited ? "Favorited" : "Favorite"}
          on={meta?.favorited}
          onClick={removers.toggleFavorite}
        />
        <ActionRow
          icon={CalendarClock}
          label={
            meta?.reminders.length
              ? `Remind ${formatRelative(meta.reminders[0]!.remindAt)}`
              : "Remind me"
          }
          onClick={openers.remindMe}
        />
        <ActionRow
          icon={meta?.muted ? BellOff : Bell}
          label={meta?.muted ? "Unsubscribed" : "Unsubscribe"}
          onClick={removers.toggleMute}
        />
        <ActionRow icon={OctagonAlert} label="Escalate…" onClick={onEscalate} />
        <ActionRow
          icon={Workflow}
          label="Automate from this task…"
          onClick={onAutomate}
        />
      </RailSection>

      <TaskAutomationsSection propertyId={propertyId} />

      <RailSection title="More" defaultOpen={false}>
        <ActionRow
          icon={History}
          label="Show description history"
          muted={!meta?.descriptionRevisions.length}
          onClick={openers.showHistory}
        />
        <ActionRow icon={Trash2} label="Delete" destructive onClick={onDelete} />
      </RailSection>
    </aside>
  );
}

/** A collapsible rail group under a gr8r `.dsec-h` heading. */
function RailSection({
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
    <section className="g8-trail-sec">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="dsec-h g8-trail-h"
        aria-expanded={open}
      >
        <h3>{title}</h3>
        <Gi icon={open ? ChevronDown : ChevronRight} size={13} />
      </button>
      {open ? <div className="g8-trail-body">{children}</div> : null}
    </section>
  );
}

function ActionRow({
  icon,
  label,
  muted,
  destructive,
  on,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  muted?: boolean;
  destructive?: boolean;
  /** A toggled-on state (favorited) — tints the icon amber, gr8r's star. */
  on?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "sitem",
        muted && "g8-muted",
        destructive && "g8-danger",
        on && "g8-on-star",
      )}
      aria-pressed={on === undefined ? undefined : on}
    >
      <Gi icon={icon} size={15} />
      <span className="trunc">{label}</span>
    </button>
  );
}

function LabelChip({
  label,
  color,
  onRemove,
}: {
  label: string;
  color: EntityColor;
  onRemove: () => void;
}) {
  return (
    <span className="lbl g8-lbl-x">
      <i style={cVar(g8Color(color))} />
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="g8-lbl-rm"
      >
        <Gi icon={X} size={11} />
      </button>
    </span>
  );
}

/** One resource row: icon, the link, hover-revealed actions. */
function ResourceRow({
  icon,
  children,
  actions,
}: {
  icon: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="sitem g8-res-row">
      {icon}
      <span className="grow trunc">{children}</span>
      <span className="g8-res-acts">{actions}</span>
    </div>
  );
}

function RemoveBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="ibtn ibtn-xs"
    >
      <Gi icon={X} size={12} />
    </button>
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
    <ResourceRow
      icon={<Gi icon={Link2} size={15} />}
      actions={
        <>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open link"
            className="ibtn ibtn-xs"
          >
            <Gi icon={ExternalLink} size={12} />
          </a>
          <RemoveBtn label="Remove link" onClick={onRemove} />
        </>
      }
    >
      <a href={url} target="_blank" rel="noopener noreferrer" className="g8-ul">
        {title || url}
      </a>
    </ResourceRow>
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
    <ResourceRow
      icon={<Gi icon={FileText} size={15} />}
      actions={<RemoveBtn label="Unlink document" onClick={onRemove} />}
    >
      <Link href={`/p/${propertyId}/docs/${documentId}`} className="g8-ul">
        {title}
      </Link>
    </ResourceRow>
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
    <ResourceRow
      icon={<Gi icon={Paperclip} size={15} />}
      actions={<RemoveBtn label="Remove attachment" onClick={onRemove} />}
    >
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="g8-ul">
          {fileName}
        </a>
      ) : (
        fileName
      )}
    </ResourceRow>
  );
}

function RelatedTaskRow({
  propertyId,
  taskId,
  title,
  status,
  relation = "related",
  onRemove,
}: {
  propertyId: string;
  taskId: string;
  title: string;
  status: string;
  relation?: "related" | "blocks" | "blocked_by";
  onRemove: () => void;
}) {
  return (
    <ResourceRow
      icon={<StatusIcon status={status} className="size-3.5 shrink-0" />}
      actions={<RemoveBtn label="Remove relation" onClick={onRemove} />}
    >
      <Link href={taskHref(propertyId, taskId)} className="g8-ul">
        {title}
      </Link>
      {relation !== "related" ? (
        <span
          className={cn(
            "g8-rel-tag",
            relation === "blocked_by" && "danger",
          )}
        >
          {relation === "blocked_by" ? "Blocked by" : "Blocks"}
        </span>
      ) : null}
    </ResourceRow>
  );
}

function StatusPicker({
  status,
  options,
  row,
  onSelect,
}: {
  status: string;
  options?: ColumnDef[];
  row?: StatusRowFields;
  onSelect: (status: string) => void;
}) {
  const view = describeStatus(options ?? [], status, row);
  return (
    <>
      <dt>
        <Gi icon={CircleDot} size={14} />
        Status
      </dt>
      <dd>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className="pillbtn">
                <G8StatusIcon
                  category={view.category}
                  blocked={view.isBlocked}
                  color={view.color}
                />
                <span className="trunc">{view.label}</span>
              </button>
            }
          />
          <StatusMenuContent
            align="end"
            options={options}
            current={status}
            onSelect={onSelect}
          />
        </DropdownMenu>
      </dd>
    </>
  );
}

function PriorityPicker({
  priority,
  onSelect,
}: {
  priority: TaskPriority;
  onSelect: (priority: TaskPriority) => void;
}) {
  const none = priority === "none";
  return (
    <>
      <dt>
        <Gi icon={SignalHigh} size={14} />
        Priority
      </dt>
      <dd>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className={cn("pillbtn", none && "empty")}>
                <G8PriorityIcon priority={priority} />
                {none ? "Set priority" : PRIORITY_NAME[priority]}
              </button>
            }
          />
          <PriorityMenuContent align="end" onSelect={onSelect} />
        </DropdownMenu>
      </dd>
    </>
  );
}

function AssigneePicker({
  assignee,
  assigneeId,
  members,
  onSelect,
  assigneeIds,
  assigneeInfos,
  onAssigneesChange,
}: {
  assignee: { name: string; avatar?: string } | undefined;
  assigneeId: string | null;
  members: Member[];
  onSelect: (id: string | null) => void;
  assigneeIds?: string[];
  assigneeInfos?: Record<string, { name: string; avatar?: string }>;
  onAssigneesChange?: (ids: string[]) => void;
}) {
  return (
    <>
      <dt>
        <Gi icon={User} size={14} />
        Assignee
      </dt>
      <dd>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn("pillbtn", !assigneeId && "empty")}
              >
                {/* One avatar (the primary); the label carries "+N". */}
                <Av
                  member={
                    assigneeId && assignee
                      ? {
                          id: assigneeId,
                          name: assignee.name,
                          avatarUrl: assignee.avatar,
                        }
                      : null
                  }
                />
                <span className="trunc">
                  {assigneeSummary(assigneeIds, assigneeInfos, assignee?.name)}
                </span>
              </button>
            }
          />
          <AssigneeMenuContent
            align="end"
            members={members}
            onSelect={onSelect}
            selectedIds={onAssigneesChange ? (assigneeIds ?? []) : undefined}
            onChange={onAssigneesChange}
          />
        </DropdownMenu>
      </dd>
    </>
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
    <>
      <dt>
        <Gi icon={Calendar} size={14} />
        Due date
      </dt>
      <dd>
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn(
                  "pillbtn",
                  !dueAt && "empty",
                  isOverdueDay(dueAt) && "over",
                )}
              >
                <Gi icon={Calendar} size={13} />
                {formatDueLabel(dueAt)}
              </button>
            }
          />
          <DueDatePopoverContent align="end" dueAt={dueAt} onChange={onChange} />
        </Popover>
      </dd>
    </>
  );
}

function RecurrencePicker({
  recurrence,
  onSelect,
}: {
  recurrence: TaskRecurrence | null;
  onSelect: (r: TaskRecurrence | null) => void;
}) {
  return (
    <>
      <dt>
        <Gi icon={Repeat} size={14} />
        Repeat
      </dt>
      <dd>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn("pillbtn", !recurrence && "empty")}
              >
                <Gi icon={Repeat} size={13} />
                {recurrence ? RECURRENCE_LABEL[recurrence] : "Does not repeat"}
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            {(Object.keys(RECURRENCE_LABEL) as TaskRecurrence[]).map((r) => (
              <DropdownMenuItem
                key={r}
                onClick={() => onSelect(r)}
                className="gap-2"
              >
                <span className="flex-1">{RECURRENCE_LABEL[r]}</span>
                {recurrence === r ? <Check className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
            {recurrence ? (
              <DropdownMenuItem
                onClick={() => onSelect(null)}
                className="gap-2 text-muted-foreground"
              >
                Does not repeat
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </dd>
    </>
  );
}

function MarkAsPicker({
  status,
  options,
  onSelect,
}: {
  status: string;
  options?: ColumnDef[];
  onSelect: (status: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className="sitem g8-muted">
            <Gi icon={Flag} size={15} />
            <span className="trunc">Mark as</span>
          </button>
        }
      />
      <StatusMenuContent
        align="end"
        options={options}
        current={status}
        onSelect={onSelect}
      />
    </DropdownMenu>
  );
}

/**
 * gr8r's drawer "Subtasks" section (`.dsec` + `.subt` rows) over our
 * sub-issues: a checkbox completes / reopens one in place, the title opens
 * it, and the add row is always there (Enter adds, Esc clears).
 */
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
  /** The parent's status (id or literal) — a new sub-issue starts there. */
  status: string;
  /** Set by the rail's "Add sub-issues" — focuses the add row. */
  adding: boolean;
  onStartAdd: () => void;
  onCancelAdd: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const { data: meta } = useQuery(taskDetailMetaQueryOptions(propertyId, taskId));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [adding]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["task-meta", propertyId, taskId] });
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  };

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
      refresh();
    });
  }

  function toggleSub(subId: string, done: boolean) {
    startTransition(async () => {
      const { updateTask } = await import("./actions");
      // Legacy literals — the DB resolves them to the sub-issue's own
      // list's closed / open status.
      const result = await updateTask({
        taskId: subId,
        status: done ? "todo" : "done",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      refresh();
    });
  }

  const subIssues = meta?.subIssues ?? [];
  const doneCount = subIssues.filter((s) => isDone({ status: s.status })).length;
  const pct = subIssues.length
    ? Math.round((doneCount / subIssues.length) * 100)
    : 0;

  return (
    <div className="dsec">
      <div className="dsec-h">
        <h3>Sub-issues</h3>
        <span className="cnt num">
          {doneCount}/{subIssues.length}
        </span>
        {subIssues.length ? (
          <span className="g8-dsec-prog">
            <ProgBar
              value={pct}
              tone={doneCount === subIssues.length ? "green" : ""}
            />
          </span>
        ) : null}
      </div>
      {subIssues.map((sub) => {
        const done = isDone({ status: sub.status });
        return (
          <div key={sub.id} className={cn("subt", done && "done")}>
            <input
              type="checkbox"
              className="check"
              checked={done}
              disabled={pending}
              onChange={() => toggleSub(sub.id, done)}
              aria-label={`${done ? "Reopen" : "Complete"} sub-issue ${sub.title}`}
            />
            <StatusIcon status={sub.status} className="size-3.5 shrink-0" />
            <Link href={taskHref(propertyId, sub.id)} className="s">
              {sub.title}
            </Link>
            <Link
              href={taskHref(propertyId, sub.id)}
              className="ibtn ibtn-xs x"
              aria-label="Open sub-issue"
              tabIndex={-1}
            >
              <Gi icon={ChevronRight} size={14} />
            </Link>
          </div>
        );
      })}
      <div className="subt g8-subt-add">
        <Gi icon={Plus} size={15} />
        <input
          ref={inputRef}
          className="inline-in"
          placeholder="Add sub-issue"
          aria-label="Add sub-issue"
          value={title}
          disabled={pending}
          onFocus={onStartAdd}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              createSubIssue();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setTitle("");
              onCancelAdd();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (!title.trim()) onCancelAdd();
          }}
        />
      </div>
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
    <RailSection title="Automations">
      {applicable.slice(0, 6).map((w) => (
        <Link
          key={w.id}
          href={`/p/${propertyId}/workflows/${w.id}`}
          className="sitem"
        >
          <span
            className="pdot"
            style={cVar(w.enabled ? "var(--g8-green)" : "var(--g8-text-4)")}
            title={w.enabled ? "On" : "Off"}
            aria-label={w.enabled ? "On" : "Off"}
          />
          <span className="grow trunc">{w.name}</span>
          <span className="ct">
            {w.trigger_event_type?.replace("task.", "on ").replace(/_/g, " ")}
          </span>
        </Link>
      ))}
    </RailSection>
  );
}
