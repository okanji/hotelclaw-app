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
import { taskKey } from "@/components/tasks/kanban";
import { Av, G8_COLOR, StIcon } from "@/components/gr8r/home-glyphs";
import { taskHref } from "@/lib/tasks/task-href";
import type { EntityColor } from "@/lib/db/types";
import type { CycleTask } from "@/lib/cycles/types";
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
      <Link href={taskHref(propertyId, task.id)} className="mini">
        <span className="faint num" style={{ width: 56, flexShrink: 0, fontSize: "var(--g8-fs-xs)" }}>
          {lookups.taskKey(task.id)}
        </span>
        <StIcon task={task} />
        <span className="tt" style={{ fontWeight: 500 }}>
          {task.title}
        </span>
        {note ? (
          <span className="faint hidden sm:inline" style={{ flexShrink: 0, fontSize: "var(--g8-fs-xs)" }}>
            {note}
          </span>
        ) : null}
        <span className="hidden shrink-0 items-center gap-1 md:flex">
          {task.labels.slice(0, 2).map((l) => (
            <span key={l} className="lbl">
              <i style={{ "--g8-c": G8_COLOR[lookups.labelColor(l)] } as CSSVars} />
              <span className="trunc" style={{ maxWidth: 96 }}>
                {l}
              </span>
            </span>
          ))}
        </span>
        {project ? (
          <span className="pj hidden lg:inline-flex" style={{ flexShrink: 0 }}>
            <span className="pdot" style={{ "--g8-c": G8_COLOR[project.color] } as CSSVars} />
            <span className="trunc">{project.name}</span>
          </span>
        ) : null}
        <EstimateChip estimate={task.estimate} />
        {task.due_at ? (
          <span className="due hidden sm:inline-flex" style={{ width: 48, justifyContent: "flex-end" }}>
            {formatDue(task.due_at)}
          </span>
        ) : null}
        <Av
          member={
            assignee && task.assignee_id
              ? { id: task.assignee_id, name: assignee.name, avatarUrl: assignee.avatarUrl }
              : null
          }
        />
      </Link>
    </li>
  );
}

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;
