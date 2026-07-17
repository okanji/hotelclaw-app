"use client";

import { type ReactNode } from "react";
import {
  CalendarPlus,
  ExternalLink,
  FileText,
  Link2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Tag,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { COLUMNS, PRIORITY_META, PRIORITY_MENU_ORDER } from "./kanban";
import { NoPriorityGlyph, PriorityBars, StatusIcon } from "./task-icons";
import type {
  TaskDetailOpeners,
  TaskDetailRemovers,
} from "./task-detail-mutations";
import type { TaskDetailMeta } from "@/lib/tasks/task-detail-meta";
import type { EntityColor, TaskPriority, TaskStatus } from "@/lib/db/types";
import { useQuery } from "@tanstack/react-query";
import { labelsQueryOptions } from "@/lib/query/label-queries";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import { Button } from "@/components/ui/button";
import {
  AssigneeMenuContent,
  DueDatePopoverContent,
  PriorityMenuContent,
  StatusMenuContent,
  initials,
  PROPERTY_CHIP_CLASS as CHIP_BASE,
  PropertyChipIcon as ChipIcon,
} from "./task-property-menus";



type Member = { id: string; name: string | null; avatarUrl: string | null };

function formatTargetDate(iso: string | null) {
  if (!iso) return "Target date";
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
 * Linear-style inline property strip surfaced directly under the title and
 * description. Mirrors the right-hand sidebar but as compact pill chips so
 * the most common edits live in the main reading flow.
 */
export function TaskDetailInlineProperties({
  propertyId,
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
}: {
  propertyId: string;
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
}) {
  const statusLabel =
    COLUMNS.find((c) => c.id === status)?.label ?? status.replace("_", " ");
  const priorityMuted = priority === "none";
  const priorityLabel = priorityMuted
    ? "No priority"
    : PRIORITY_META[priority].label;

  const links = meta?.links ?? [];
  const docs = meta?.documents ?? [];
  const attachments = meta?.attachments ?? [];
  const resourcesCount = links.length + docs.length + attachments.length;
  const labels = meta?.labels ?? [];
  const { data: labelCatalog = [] } = useQuery(labelsQueryOptions(propertyId));
  const labelColor = (name: string): EntityColor =>
    labelCatalog.find((l) => l.name.toLowerCase() === name.toLowerCase())
      ?.color ?? "slate";

  return (
    <div className="mt-5 space-y-2 text-sm">
      <PropertyRow label="Properties">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className={cn(CHIP_BASE, "text-foreground/90")}>
                <ChipIcon><StatusIcon status={status} className="size-3.5" /></ChipIcon>
                <span className="truncate">{statusLabel}</span>
              </button>
            }
          />
          <StatusMenuContent align="start" onSelect={onStatusChange} />
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(
                  CHIP_BASE,
                  priorityMuted ? "text-muted-foreground" : "text-foreground/90",
                )}
              >
                <ChipIcon>
                  {priorityMuted ? (
                    <NoPriorityGlyph variant="inline" />
                  ) : (
                    <PriorityBars priority={priority} />
                  )}
                </ChipIcon>
                <span className="truncate">{priorityLabel}</span>
              </button>
            }
          />
          <PriorityMenuContent align="start" onSelect={onPriorityChange} />
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(
                  CHIP_BASE,
                  assigneeId ? "text-foreground/90" : "text-muted-foreground",
                )}
              >
                <ChipIcon>
                  {assignee ? (
                    <Avatar size="sm" className="size-3.5">
                      {assignee.avatar ? (
                        <AvatarImage src={assignee.avatar} alt={assignee.name} />
                      ) : null}
                      <AvatarFallback className="bg-muted text-[0.5rem]">
                        {initials(assignee.name)}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <UserRound className="size-3.5" />
                  )}
                </ChipIcon>
                <span className="truncate">{assignee?.name ?? "Assign"}</span>
              </button>
            }
          />
          <AssigneeMenuContent
            align="start"
            members={members}
            onSelect={onAssigneeChange}
          />
        </DropdownMenu>

        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn(
                  CHIP_BASE,
                  dueAt ? "text-foreground/90" : "text-muted-foreground",
                )}
              >
                <ChipIcon><CalendarPlus className="size-3.5" /></ChipIcon>
                <span className="truncate">{formatTargetDate(dueAt)}</span>
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

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="More properties"
                className="text-muted-foreground"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
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
      </PropertyRow>

      <PropertyRow label="Labels">
        {labels.map((label) => (
          <RemovableChip
            key={label}
            icon={<LabelDot color={labelColor(label)} />}
            label={label}
            onRemove={() => removers.removeLabel(label)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label="Add label"
          onClick={openers.addLabel}
          className="text-muted-foreground"
        >
          <Plus className="size-3.5" />
        </Button>
      </PropertyRow>

      <PropertyRow label="Resources">
        {links.map((link) => (
          <ResourceChip
            key={link.id}
            href={link.url}
            external
            icon={<Link2 className="size-3.5" />}
            label={link.title || link.url}
            onRemove={() => removers.removeLink(link.id)}
            hoverIcon={<ExternalLink className="size-3" />}
          />
        ))}
        {docs.map((doc) => (
          <ResourceChip
            key={doc.id}
            href={`/p/${propertyId}/docs/${doc.documentId}`}
            icon={<FileText className="size-3.5" />}
            label={doc.title}
            onRemove={() => removers.unlinkDocument(doc.id)}
          />
        ))}
        {attachments.map((file) => (
          <ResourceChip
            key={file.id}
            href={file.url}
            external
            icon={<Paperclip className="size-3.5" />}
            label={file.fileName}
            onRemove={() => removers.removeAttachment(file.id)}
          />
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              >
                <Plus className="size-3.5" />
                {resourcesCount === 0
                  ? "Add document or link…"
                  : "Add resource"}
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
      </PropertyRow>
    </div>
  );
}

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-20 shrink-0 pt-1 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {children}
      </div>
    </div>
  );
}

function RemovableChip({
  icon,
  label,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        CHIP_BASE,
        "group cursor-default text-foreground/90 hover:bg-transparent",
      )}
    >
      <ChipIcon>{icon}</ChipIcon>
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.08] hover:text-foreground group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function ResourceChip({
  href,
  external,
  icon,
  label,
  hoverIcon,
  onRemove,
}: {
  href: string;
  external?: boolean;
  icon: ReactNode;
  label: string;
  hoverIcon?: ReactNode;
  onRemove: () => void;
}) {
  // `<button>` cannot be a descendant of `<a>` — render the link and the
  // remove control as siblings inside a flex chip shell.
  const linkClass = "flex min-w-0 items-center gap-1.5 hover:underline";
  const inner = (
    <>
      <ChipIcon>{icon}</ChipIcon>
      <span className="truncate">{label}</span>
      {hoverIcon ? (
        <span className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {hoverIcon}
        </span>
      ) : null}
    </>
  );
  return (
    <span
      className={cn(
        CHIP_BASE,
        "group max-w-[260px] cursor-default text-foreground/90 hover:bg-transparent",
      )}
    >
      {external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          {inner}
        </a>
      ) : (
        <Link href={href} className={linkClass}>
          {inner}
        </Link>
      )}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.08] hover:text-foreground group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function LabelDot({ color = "slate" }: { color?: EntityColor }) {
  return (
    <span className={cn("inline-block size-2 rounded-full", LABEL_DOT[color])} />
  );
}
