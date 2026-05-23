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
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

type Member = { id: string; name: string | null; avatarUrl: string | null };

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

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

// Shared chip styles — small bordered pills with consistent typography.
const CHIP_BASE =
  "inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[0.75rem] transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50";

const CHIP_ICON_BUTTON =
  "inline-flex size-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50";

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

  return (
    <div className="mt-5 space-y-2 text-[0.8125rem]">
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
          <DropdownMenuContent align="start" className="w-44">
            {COLUMNS.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => onStatusChange(c.id)}
                className="gap-2"
              >
                <StatusIcon status={c.id} className="size-3.5" />
                {c.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
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
          <DropdownMenuContent align="start" className="w-48 p-1">
            {PRIORITY_MENU_ORDER.map((p) => (
              <DropdownMenuItem
                key={p}
                onClick={() => onPriorityChange(p)}
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
          <DropdownMenuContent
            align="start"
            className="max-h-64 w-56 overflow-y-auto"
          >
            <DropdownMenuItem onClick={() => onAssigneeChange(null)}>
              Unassigned
            </DropdownMenuItem>
            {members.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => onAssigneeChange(m.id)}
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
          <PopoverContent align="start" className="w-56 p-3">
            <label className="text-[0.75rem] font-medium text-muted-foreground">
              Target date
            </label>
            <input
              type="date"
              value={toDateInputValue(dueAt)}
              onChange={(e) => onDueAtChange(dateInputToIso(e.target.value))}
              className={cn(
                "mt-2 h-8 w-full rounded-md border border-input bg-transparent px-2 text-[0.8125rem]",
                "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              )}
            />
            {dueAt ? (
              <button
                type="button"
                onClick={() => onDueAtChange(null)}
                className="mt-2 text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear date
              </button>
            ) : null}
          </PopoverContent>
        </Popover>

        {meta?.projectName ? (
          <RemovableChip
            icon={
              <span className="inline-flex size-3.5 items-center justify-center rounded-full border border-muted-foreground/50" />
            }
            label={meta.projectName}
            onRemove={removers.removeProject}
          />
        ) : (
          <button
            type="button"
            onClick={openers.addProject}
            className={cn(CHIP_BASE, "text-muted-foreground")}
          >
            <ChipIcon>
              <span className="inline-flex size-3.5 items-center justify-center rounded-full border border-muted-foreground/50" />
            </ChipIcon>
            <span className="truncate">Project</span>
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="More properties"
                className={CHIP_ICON_BUTTON}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={openers.addLabel} className="gap-2">
              <Tag className="size-3.5" />
              Add label
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openers.addProject} className="gap-2">
              <span className="inline-flex size-3.5 items-center justify-center rounded-full border border-muted-foreground/50" />
              Add to project
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
            icon={<LabelDot />}
            label={label}
            onRemove={() => removers.removeLabel(label)}
          />
        ))}
        <button
          type="button"
          aria-label="Add label"
          onClick={openers.addLabel}
          className={CHIP_ICON_BUTTON}
        >
          <Plus className="size-3.5" />
        </button>
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
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border/60 px-2 py-1 text-[0.75rem] text-muted-foreground transition-colors hover:border-border hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
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
      <span className="w-20 shrink-0 pt-1 text-[0.75rem] text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {children}
      </div>
    </div>
  );
}

function ChipIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
      {children}
    </span>
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

function LabelDot() {
  return <span className="inline-block size-2 rounded-full bg-blue-500" />;
}
