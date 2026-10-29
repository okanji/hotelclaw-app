"use client";

import { assigneeSummary } from "@/lib/tasks/assignee-label";
import { type ReactNode } from "react";
import {
  Calendar,
  CalendarPlus,
  Check,
  CircleDot,
  ExternalLink,
  FileText,
  Link2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Repeat,
  SignalHigh,
  Tag,
  Timer,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PRIORITY_META } from "./kanban";
import { describeStatus, type ColumnDef } from "@/lib/tasks/statuses";
import type {
  TaskDetailOpeners,
  TaskDetailRemovers,
} from "./task-detail-mutations";
import type { TaskDetailMeta } from "@/lib/tasks/task-detail-meta";
import type {
  EntityColor,
  TaskPriority,
  TaskRecurrence,
} from "@/lib/db/types";
import { useQuery } from "@tanstack/react-query";
import { labelsQueryOptions } from "@/lib/query/label-queries";
import {
  AssigneeMenuContent,
  DueDatePopoverContent,
  PriorityMenuContent,
  StatusMenuContent,
  type StatusRowFields,
} from "./task-property-menus";
import { TaskPlanningChips } from "@/components/cycles/task-planning-chips";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import {
  G8PriorityIcon,
  G8StatusIcon,
  cVar,
  g8Color,
} from "@/components/gr8r/my-tasks-glyphs";

type Member = { id: string; name: string | null; avatarUrl: string | null };

/** Repeat cadence labels (migration 0107). When the task is completed, the
 *  next occurrence is created with the due date pushed by one cadence. */
export const RECURRENCE_LABEL: Record<TaskRecurrence, string> = {
  daily: "Repeats daily",
  weekly: "Repeats weekly",
  biweekly: "Every 2 weeks",
  monthly: "Repeats monthly",
};

function formatTargetDate(iso: string | null) {
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
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The task's properties under its title, as gr8r's drawer lays them out: a
 * `dl.kv` of icon + label / value-pill rows. The narrow-width (and embedded)
 * home of properties; on the full page the docked rail takes over at @4xl.
 */
export function TaskDetailInlineProperties({
  propertyId,
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
  taskId,
}: {
  propertyId: string;
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
  /** Repeat cadence (migration 0107). Omit to hide the control. */
  recurrence?: TaskRecurrence | null;
  onRecurrenceChange?: (r: TaskRecurrence | null) => void;
  /** Enables the planning chips (Estimate / Cycle / Milestone, 0111), which
   *  read + write the task themselves. Omit to hide them. */
  taskId?: string;
}) {
  const statusView = describeStatus(statusOptions ?? [], status, statusRow);
  const priorityMuted = priority === "none";
  const priorityLabel = priorityMuted
    ? "No priority"
    : PRIORITY_META[priority].label;

  const links = meta?.links ?? [];
  const docs = meta?.documents ?? [];
  // Slot files (0116) render in their Files field, not as loose attachments.
  const resourcesCount = links.length + docs.length;
  const overdue = (() => {
    if (!dueAt) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(dueAt);
    d.setHours(0, 0, 0, 0);
    return d.getTime() < today.getTime();
  })();
  const labels = meta?.labels ?? [];
  const { data: labelCatalog = [] } = useQuery(labelsQueryOptions(propertyId));
  const labelColor = (name: string): EntityColor =>
    labelCatalog.find((l) => l.name.toLowerCase() === name.toLowerCase())
      ?.color ?? "slate";

  return (
    // gr8r's drawer property grid (`dl.kv`: dt icon + label, dd value pill).
    <dl className="kv g8-task-kv">
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
                  category={statusView.category}
                  blocked={statusView.isBlocked}
                  color={statusView.color}
                />
                <span className="trunc">{statusView.label}</span>
              </button>
            }
          />
          <StatusMenuContent
            align="start"
            options={statusOptions}
            current={status}
            onSelect={onStatusChange}
          />
        </DropdownMenu>
      </dd>

      <dt>
        <Gi icon={SignalHigh} size={14} />
        Priority
      </dt>
      <dd>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn("pillbtn", priorityMuted && "empty")}
              >
                <G8PriorityIcon priority={priority} />
                {priorityLabel}
              </button>
            }
          />
          <PriorityMenuContent align="start" onSelect={onPriorityChange} />
        </DropdownMenu>
      </dd>

      <dt>
        <Gi icon={UserRound} size={14} />
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
            align="start"
            members={members}
            onSelect={onAssigneeChange}
            selectedIds={onAssigneesChange ? (assigneeIds ?? []) : undefined}
            onChange={onAssigneesChange}
          />
        </DropdownMenu>
      </dd>

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
                  overdue && "over",
                )}
              >
                <Gi icon={Calendar} size={13} />
                {formatTargetDate(dueAt)}
              </button>
            }
          />
          <DueDatePopoverContent
            align="start"
            label="Target date"
            clearLabel="Clear date"
            dueAt={dueAt}
            onChange={onDueAtChange}
          />
        </Popover>
      </dd>

      {onRecurrenceChange ? (
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
                  />
                }
              >
                <Gi icon={Repeat} size={13} />
                {recurrence ? RECURRENCE_LABEL[recurrence] : "Does not repeat"}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                {(Object.keys(RECURRENCE_LABEL) as TaskRecurrence[]).map(
                  (r) => (
                    <DropdownMenuItem
                      key={r}
                      onClick={() => onRecurrenceChange(r)}
                      className="gap-2"
                    >
                      <span className="flex-1">{RECURRENCE_LABEL[r]}</span>
                      {recurrence === r ? <Check className="size-3.5" /> : null}
                    </DropdownMenuItem>
                  ),
                )}
                <DropdownMenuItem
                  onClick={() => onRecurrenceChange(null)}
                  className="gap-2 text-muted-foreground"
                >
                  Does not repeat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </dd>
        </>
      ) : null}

      {taskId ? (
        <>
          <dt>
            <Gi icon={Timer} size={14} />
            Planning
          </dt>
          <dd>
            <TaskPlanningChips propertyId={propertyId} taskId={taskId} />
          </dd>
        </>
      ) : null}

      <dt>
        <Gi icon={Tag} size={14} />
        Labels
      </dt>
      <dd>
        {labels.map((label) => (
          <span key={label} className="lbl g8-lbl-x">
            <i style={cVar(g8Color(labelColor(label)))} />
            {label}
            <button
              type="button"
              aria-label={`Remove ${label}`}
              onClick={() => removers.removeLabel(label)}
              className="g8-lbl-rm"
            >
              <Gi icon={X} size={11} />
            </button>
          </span>
        ))}
        <button
          type="button"
          className="pillbtn empty"
          onClick={openers.addLabel}
          aria-label="Add label"
        >
          {labels.length ? (
            <Gi icon={Plus} size={13} />
          ) : (
            <>
              <Gi icon={Tag} size={13} />
              Add labels
            </>
          )}
        </button>
      </dd>

      <dt>
        <Gi icon={Link2} size={14} />
        Resources
      </dt>
      <dd>
        {links.map((link) => (
          <ResourceChip
            key={link.id}
            href={link.url}
            external
            icon={<Gi icon={Link2} size={13} />}
            label={link.title || link.url}
            onRemove={() => removers.removeLink(link.id)}
          />
        ))}
        {docs.map((doc) => (
          <ResourceChip
            key={doc.id}
            href={`/p/${propertyId}/docs/${doc.documentId}`}
            icon={<Gi icon={FileText} size={13} />}
            label={doc.title}
            onRemove={() => removers.unlinkDocument(doc.id)}
          />
        ))}
        {/* Files sit in the task's Attachments section below. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className="pillbtn empty">
                <Gi icon={Plus} size={13} />
                {resourcesCount === 0 ? "Add document or link" : "Add"}
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={openers.addLink} className="gap-2">
              <Link2 className="size-3.5" />
              Add link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openers.addDocument} className="gap-2">
              <FileText className="size-3.5" />
              Add document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openers.attachFile} className="gap-2">
              <Paperclip className="size-3.5" />
              Attach file
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </dd>

      <dt>
        <Gi icon={MoreHorizontal} size={14} />
        More
      </dt>
      <dd>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="ibtn ibtn-sm"
                aria-label="More properties"
              >
                <Gi icon={MoreHorizontal} size={15} />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={openers.addLabel} className="gap-2">
              <Tag className="size-3.5" />
              Add label
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={openers.createRelated}
              className="gap-2"
            >
              <Plus className="size-3.5" />
              Create related
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openers.remindMe} className="gap-2">
              <CalendarPlus className="size-3.5" />
              Remind me
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </dd>
    </dl>
  );
}

function ResourceChip({
  href,
  external,
  icon,
  label,
  onRemove,
}: {
  href: string;
  external?: boolean;
  icon: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  // `<button>` cannot be a descendant of `<a>` — the link and the remove
  // control are siblings inside one pill.
  const inner = (
    <>
      {icon}
      <span className="trunc">{label}</span>
    </>
  );
  return (
    <span className="pillbtn bordered g8-res-chip">
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="g8-res-link">
          {inner}
          <Gi icon={ExternalLink} size={11} className="g8-res-ext" />
        </a>
      ) : (
        <Link href={href} className="g8-res-link">
          {inner}
        </Link>
      )}
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
