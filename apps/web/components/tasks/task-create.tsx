"use client";

import { useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronDown, ListChecks, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createTask } from "./actions";
import { COLUMNS } from "./kanban";
import { NoPriorityGlyph, PriorityBars, StatusIcon } from "./task-icons";
import {
  AssigneeMenuContent,
  DueDatePopoverContent,
  PriorityMenuContent,
  StatusMenuContent,
  initials,
  PROPERTY_CHIP_CLASS as CHIP_BASE,
  PropertyChipIcon as ChipIcon,
} from "./task-property-menus";
import { PRIORITY_META } from "./kanban";
import { taskHref } from "@/lib/tasks/task-href";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { orgChartQueryOptions } from "@/lib/query/org-queries";
import { useAssigneesMap } from "@/lib/tasks/use-assignees";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

function formatTargetDate(iso: string | null) {
  if (!iso) return "Target date";
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(d);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Soft-navigate within the persistent tasks surface (no route push / skeleton). */
function surfaceNavigate(href: string) {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event("hotelclaw:pathname"));
}

/**
 * Full-page task creation — the "open an empty task" experience. Replaces the
 * old modal so every property (status, priority, assignee, team, due date,
 * description) has room up-front. Visually mirrors the task detail reading
 * column so creating and viewing feel like one surface.
 *
 * Defaults come off the URL: `?status=`, `?space=`, `?project=` (set by the
 * board when the "+"/New-task affordances open this page from a scoped view).
 */
export function TaskCreatePage({
  propertyId,
  currentUserId,
  defaultStatus = "todo",
  defaultSpaceId = null,
  defaultProjectId = null,
}: {
  propertyId: string;
  currentUserId: string;
  defaultStatus?: TaskStatus;
  defaultSpaceId?: string | null;
  defaultProjectId?: string | null;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  // Team defaults to the board's scope if set, else the creator's home team
  // (resolved async from the org chart). `teamOverride` distinguishes "user
  // hasn't touched it" (null → use the default) from an explicit pick,
  // including "No team" ("") — so the async home-team default flows in without
  // an effect and stops the moment the user chooses.
  const { data: org } = useQuery(orgChartQueryOptions(propertyId));
  const teams = org?.teams ?? [];
  const myPrimaryTeamId =
    org?.people.find((p) => p.id === currentUserId)?.primaryTeamId ?? null;
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const teamId =
    teamOverride !== null ? teamOverride : (defaultSpaceId ?? myPrimaryTeamId ?? "");

  const assignees = useAssigneesMap([assigneeId]);
  const assignee = assigneeId ? assignees[assigneeId] : undefined;

  const statusLabel =
    COLUMNS.find((c) => c.id === status)?.label ?? status.replace("_", " ");
  const priorityMuted = priority === "none";
  const priorityLabel = priorityMuted ? "No priority" : PRIORITY_META[priority].label;
  const teamName = teamId ? teams.find((t) => t.id === teamId)?.name : null;

  function cancel() {
    surfaceNavigate(`/p/${propertyId}/tasks`);
  }

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      titleRef.current?.focus();
      return;
    }
    startTransition(async () => {
      const result = await createTask({
        propertyId,
        title: trimmed,
        description: description.trim() || undefined,
        status,
        priority,
        assigneeId: assigneeId ?? undefined,
        // Explicit choice: a team id, or null for "No team".
        spaceId: teamId || null,
        projectId: defaultProjectId ?? null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Task created");
      // Refresh the shared list cache so the detail (which reads from it) and
      // the board both pick up the new row, then open the task we just made.
      await qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
      surfaceNavigate(taskHref(propertyId, result.taskId));
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          {
            label: "Tasks",
            href: `/p/${propertyId}/tasks`,
            icon: <ListChecks />,
          },
          { label: "New task" },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mx-auto max-w-[820px] px-10 pt-16 pb-12"
        >
          <textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              // Enter in the title moves to details; Cmd/Ctrl+Enter submits.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
              }
            }}
            rows={1}
            autoFocus
            required
            aria-label="Task title"
            placeholder="Task title"
            disabled={pending}
            className={cn(
              "w-full resize-none border-0 bg-transparent p-0",
              "text-xl font-semibold leading-[1.35] tracking-tight text-foreground",
              "placeholder:text-muted-foreground/60 focus-visible:outline-none",
            )}
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add description…"
            aria-label="Task description"
            disabled={pending}
            rows={3}
            className={cn(
              "mt-3 w-full resize-none border-0 bg-transparent p-0",
              "text-sm leading-relaxed text-foreground",
              "placeholder:text-muted-foreground/70 focus-visible:outline-none",
            )}
          />

          {/* Property strip — every field a task can carry, filled up-front. */}
          <div className="mt-5 flex items-start gap-3 text-sm">
            <span className="w-20 shrink-0 pt-1 text-xs text-muted-foreground">
              Properties
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className={cn(CHIP_BASE, "text-foreground/90")}
                    >
                      <ChipIcon>
                        <StatusIcon status={status} className="size-3.5" />
                      </ChipIcon>
                      <span className="truncate">{statusLabel}</span>
                    </button>
                  }
                />
                <StatusMenuContent align="start" onSelect={setStatus} />
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        CHIP_BASE,
                        priorityMuted
                          ? "text-muted-foreground"
                          : "text-foreground/90",
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
                <PriorityMenuContent align="start" onSelect={setPriority} />
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        CHIP_BASE,
                        assigneeId
                          ? "text-foreground/90"
                          : "text-muted-foreground",
                      )}
                    >
                      <ChipIcon>
                        {assignee ? (
                          <Avatar size="sm" className="size-3.5">
                            {assignee.avatar ? (
                              <AvatarImage
                                src={assignee.avatar}
                                alt={assignee.name}
                              />
                            ) : null}
                            <AvatarFallback className="bg-muted text-[0.5rem]">
                              {initials(assignee.name)}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <UserRound className="size-3.5" />
                        )}
                      </ChipIcon>
                      <span className="truncate">
                        {assignee?.name ?? "Assign"}
                      </span>
                    </button>
                  }
                />
                <AssigneeMenuContent
                  align="start"
                  members={members}
                  onSelect={setAssigneeId}
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
                      <ChipIcon>
                        <CalendarPlus className="size-3.5" />
                      </ChipIcon>
                      <span className="truncate">{formatTargetDate(dueAt)}</span>
                    </button>
                  }
                />
                <DueDatePopoverContent
                  align="start"
                  label="Target date"
                  clearLabel="Clear date"
                  dueAt={dueAt}
                  onChange={setDueAt}
                />
              </Popover>

              {teams.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className={cn(
                          CHIP_BASE,
                          teamId ? "text-foreground/90" : "text-muted-foreground",
                        )}
                      >
                        <span className="truncate">
                          {teamName ?? "No team"}
                        </span>
                        <ChevronDown className="size-3 opacity-50" />
                      </button>
                    }
                  />
                  <DropdownMenuContent
                    align="start"
                    className="max-h-64 w-56 overflow-y-auto"
                  >
                    <DropdownMenuItem onClick={() => setTeamOverride("")}>
                      No team
                    </DropdownMenuItem>
                    {teams.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() => setTeamOverride(t.id)}
                      >
                        <span className="truncate">{t.name}</span>
                        {t.id === myPrimaryTeamId ? (
                          <span className="ml-auto text-xs text-muted-foreground">
                            your team
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>

          <div className="mt-10 flex items-center gap-2 border-t border-border/60 pt-6">
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create task"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={cancel}
              disabled={pending}
            >
              Cancel
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              <kbd className="font-sans">⌘</kbd>
              <kbd className="font-sans">Enter</kbd> to create
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
