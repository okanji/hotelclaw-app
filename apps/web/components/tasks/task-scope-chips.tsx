"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import type { EntityColor } from "@/lib/db/types";
import type { Task } from "./kanban";
import { LABEL_DOT } from "@/components/labels/label-tokens";

const DOT = LABEL_DOT;

/**
 * Space / Project chips for a task card. Resolves names + colors from the
 * already-cached spaces/projects queries (shared across all cards). propertyId
 * is read from the path — the board only ever renders under `/p/<id>/…`.
 */
export function TaskScopeChips({ task }: { task: Task }) {
  const pathname = usePathname();
  const propertyId = pathname.match(/^\/p\/([^/]+)/)?.[1];
  const { data: spaces = [] } = useQuery({
    ...spacesQueryOptions(propertyId ?? ""),
    enabled: !!propertyId && !!task.space_id,
  });
  const { data: projects = [] } = useQuery({
    ...projectsQueryOptions(propertyId ?? ""),
    enabled: !!propertyId && !!task.project_id,
  });

  const space = task.space_id
    ? spaces.find((s) => s.id === task.space_id)
    : null;
  const project = task.project_id
    ? projects.find((p) => p.id === task.project_id)
    : null;
  if (!space && !project) return null;

  return (
    <>
      {space ? <Chip color={space.color} label={space.name} /> : null}
      {project ? <Chip color={project.color} label={project.name} /> : null}
    </>
  );
}

function Chip({ color, label }: { color: EntityColor; label: string }) {
  return (
    <span className="flex max-w-[8rem] items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-faint-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[color])} />
      <span className="truncate">{label}</span>
    </span>
  );
}
