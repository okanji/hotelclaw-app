"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  propertyMembersQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { labelsQueryOptions } from "@/lib/query/label-queries";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import { StatusIcon } from "@/components/tasks/task-icons";
import { taskKey } from "@/components/tasks/kanban";
import { initials } from "@/components/tasks/task-property-menus";
import { taskHref } from "@/lib/tasks/task-href";
import type { EntityColor } from "@/lib/db/types";
import type { CycleTask } from "@/lib/cycles/types";
import { cn } from "@/lib/utils";
import { EstimateChip } from "./estimate-chip";

export { EstimateChip };

export type RowLookups = {
  member: (id: string | null) => { name: string; avatarUrl: string | null } | null;
  project: (id: string | null) => { name: string; color: EntityColor } | null;
  labelColor: (name: string) => EntityColor;
  /** Human key (`TP-11`) from the shared tasks cache; glyph fallback. */
  taskKey: (id: string) => string;
};

export type ScopeLookups = RowLookups & {
  space: (id: string | null) => { name: string; color: EntityColor } | null;
};

/** Name/colour resolvers off the shared section caches (no extra fetches). */
export function useScopeLookups(propertyId: string): ScopeLookups {
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: labels = [] } = useQuery(labelsQueryOptions(propertyId));
  const { data: tasks = [] } = useQuery(tasksQueryOptions(propertyId));
  return useMemo(() => {
    const k = new Map(tasks.map((t) => [t.id, t.key ?? null]));
    const m = new Map(members.map((x) => [x.id, x]));
    const p = new Map(projects.map((x) => [x.id, x]));
    const s = new Map(spaces.map((x) => [x.id, x]));
    const l = new Map(labels.map((x) => [x.name.toLowerCase(), x.color]));
    return {
      member: (id) => {
        const x = id ? m.get(id) : undefined;
        return x ? { name: x.name ?? x.email ?? "Member", avatarUrl: x.avatarUrl } : null;
      },
      project: (id) => {
        const x = id ? p.get(id) : undefined;
        return x ? { name: x.name, color: x.color } : null;
      },
      space: (id) => {
        const x = id ? s.get(id) : undefined;
        return x ? { name: x.name, color: x.color } : null;
      },
      labelColor: (name) => l.get(name.toLowerCase()) ?? "slate",
      taskKey: (id) => taskKey({ id, key: k.get(id) }),
    };
  }, [members, projects, spaces, labels, tasks]);
}

function formatDue(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * One issue row in a cycle — key, title, labels, project, estimate, due,
 * assignee (Linear's cycle list). The whole row links to the task page.
 */
export function CycleTaskRow({
  propertyId,
  task,
  lookups,
  note,
}: {
  propertyId: string;
  task: CycleTask;
  lookups: RowLookups;
  /** Trailing context ("Moved to Cycle 5"). */
  note?: string;
}) {
  const assignee = lookups.member(task.assignee_id);
  const project = lookups.project(task.project_id);
  return (
    <li>
      <Link
        href={taskHref(propertyId, task.id)}
        className="group flex h-[37px] items-center gap-2.5 rounded-md px-2 text-sm transition-colors hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
      >
        <span className="w-14 shrink-0 text-xs text-faint-foreground tabular-nums">
          {lookups.taskKey(task.id)}
        </span>
        <StatusIcon status={task.status} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {task.title}
        </span>
        {note ? (
          <span className="hidden shrink-0 text-xs text-faint-foreground sm:inline">
            {note}
          </span>
        ) : null}
        <span className="hidden shrink-0 items-center gap-1 md:flex">
          {task.labels.slice(0, 2).map((l) => (
            <span
              key={l}
              className="inline-flex h-5 items-center gap-1 rounded-pill px-1.5 text-xs text-muted-foreground shadow-ring"
            >
              <span
                className={cn("size-1.5 rounded-full", LABEL_DOT[lookups.labelColor(l)])}
              />
              <span className="max-w-24 truncate">{l}</span>
            </span>
          ))}
        </span>
        {project ? (
          <span className="hidden max-w-32 shrink-0 items-center gap-1 text-xs text-muted-foreground lg:inline-flex">
            <span className={cn("size-2 shrink-0 rounded-full", LABEL_DOT[project.color])} />
            <span className="truncate">{project.name}</span>
          </span>
        ) : null}
        <EstimateChip estimate={task.estimate} />
        {task.due_at ? (
          <span className="hidden w-12 shrink-0 text-right text-xs text-faint-foreground tabular-nums sm:inline">
            {formatDue(task.due_at)}
          </span>
        ) : null}
        <Avatar size="sm" className="size-5 shrink-0" title={assignee?.name ?? "Unassigned"}>
          {assignee?.avatarUrl ? (
            <AvatarImage src={assignee.avatarUrl} alt={assignee.name} />
          ) : null}
          <AvatarFallback className="bg-muted text-xs">
            {assignee ? initials(assignee.name) : "–"}
          </AvatarFallback>
        </Avatar>
      </Link>
    </li>
  );
}
