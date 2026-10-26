"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FolderKanban, List, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { useStatusCatalog } from "@/lib/query/status-queries";
import type { EntityColor } from "@/lib/db/types";
import {
  setTaskList,
  setTaskProject,
  setTaskSpace,
} from "@/components/projects/actions";
import { LABEL_DOT, LABEL_INK } from "@/components/labels/label-tokens";

const DOT = LABEL_DOT;

const ROW =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";

/**
 * Project + Team + List assignment for the task detail sidebar. Self-contained
 * — reads the task's `project_id` / `space_id` / `list_id` directly and writes
 * via setTaskProject / setTaskSpace / setTaskList, so it doesn't depend on the
 * task-meta API. Mirrors the sidebar's other property rows.
 *
 * The list row (0114) offers the task's team's lists first, then the
 * property-level ones; moving lists remaps the status by category in the
 * DB, so the tasks cache is invalidated to pick up the new status row.
 */
export function TaskProjectSpacePicker({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const qc = useQueryClient();
  const { data: assign } = useQuery({
    queryKey: ["task-assign", taskId] as const,
    queryFn: async (): Promise<{
      project_id: string | null;
      space_id: string | null;
      list_id: string | null;
    }> => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("tasks")
        .select("project_id, space_id, list_id")
        .eq("id", taskId)
        .maybeSingle();
      return {
        project_id: data?.project_id ?? null,
        space_id: data?.space_id ?? null,
        list_id: data?.list_id ?? null,
      };
    },
  });
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const catalog = useStatusCatalog(propertyId);

  const project = projects.find((p) => p.id === assign?.project_id) ?? null;
  const space = spaces.find((t) => t.id === assign?.space_id) ?? null;
  const list = assign?.list_id ? catalog.listById(assign.list_id) ?? null : null;
  const teamLists = space ? catalog.listsOfSpace(space.id) : [];
  const propertyLists = catalog.listsOfSpace(null);

  function refresh(projectId?: string | null) {
    void qc.invalidateQueries({ queryKey: ["task-assign", taskId] });
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    if (projectId)
      void qc.invalidateQueries({ queryKey: ["project-detail", projectId] });
  }

  async function pickProject(projectId: string | null) {
    const res = await setTaskProject(taskId, projectId);
    if ("error" in res) toast.error(res.error);
    else refresh(projectId ?? assign?.project_id ?? null);
  }
  async function pickSpace(spaceId: string | null) {
    const res = await setTaskSpace(taskId, spaceId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function pickList(listId: string) {
    if (listId === assign?.list_id) return;
    const res = await setTaskList(taskId, listId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

  const listItem = (l: { id: string; name: string; color: EntityColor; icon: string | null }) => (
    <DropdownMenuItem
      key={l.id}
      onClick={() => void pickList(l.id)}
      className="gap-2"
    >
      {l.icon ? (
        <span aria-hidden="true" className="text-xs">{l.icon}</span>
      ) : (
        <span className={cn("size-2.5 rounded-[3px]", DOT[l.color])} />
      )}
      <span className="min-w-0 flex-1 truncate">{l.name}</span>
      {l.id === list?.id ? <Check className="size-3.5" /> : null}
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(ROW, project ? "text-foreground" : "text-muted-foreground")}
            />
          }
        >
          <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
            {project ? (
              <span className={cn("size-2.5 rounded-md", DOT[project.color])} />
            ) : (
              <FolderKanban className="size-3.5" />
            )}
          </span>
          <span className="truncate">{project ? project.name : "Project"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-y-auto">
          <DropdownMenuItem onClick={() => void pickProject(null)}>
            No project
          </DropdownMenuItem>
          {projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => void pickProject(p.id)}
              className="gap-2"
            >
              <span className={cn("size-2.5 rounded-md", DOT[p.color])} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === project?.id ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(ROW, space ? "text-foreground" : "text-muted-foreground")}
            />
          }
        >
          <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
            <Users className={space ? textDot(space.color) : "size-3.5"} />
          </span>
          <span className="truncate">{space ? space.name : "Team"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-y-auto">
          <DropdownMenuItem onClick={() => void pickSpace(null)}>
            No space
          </DropdownMenuItem>
          {spaces.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => void pickSpace(t.id)}
              className="gap-2"
            >
              <span className={cn("size-2.5 rounded-full", DOT[t.color])} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.id === space?.id ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(ROW, list ? "text-foreground" : "text-muted-foreground")}
            />
          }
        >
          <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
            {list?.icon ? (
              <span aria-hidden="true" className="text-xs">{list.icon}</span>
            ) : (
              <List className={list ? textDot(list.color) : "size-3.5"} />
            )}
          </span>
          <span className="truncate">{list ? list.name : "List"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
          {teamLists.length > 0 ? (
            <>
              <DropdownMenuLabel className="text-xs text-faint-foreground">
                {space?.name}
              </DropdownMenuLabel>
              {teamLists.map(listItem)}
              {propertyLists.length > 0 ? <DropdownMenuSeparator /> : null}
            </>
          ) : null}
          {propertyLists.length > 0 ? (
            <>
              <DropdownMenuLabel className="text-xs text-faint-foreground">
                Property
              </DropdownMenuLabel>
              {propertyLists.map(listItem)}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function textDot(color: EntityColor): string {
  return `size-3.5 ${LABEL_INK[color]}`;
}
