"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FolderKanban, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  projectsQueryOptions,
  teamsQueryOptions,
} from "@/lib/query/project-queries";
import type { EntityColor } from "@/lib/db/types";
import { setTaskProject, setTaskTeam } from "@/components/projects/actions";

const DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

const ROW =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] transition-colors hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:outline-none";

/**
 * Project + Team assignment for the task detail sidebar. Self-contained — reads
 * the task's `project_id`/`team_id` directly and writes via setTaskProject /
 * setTaskTeam, so it doesn't depend on the task-meta API. Mirrors the sidebar's
 * other property rows.
 */
export function TaskProjectTeamPicker({
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
      team_id: string | null;
    }> => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("tasks")
        .select("project_id, team_id")
        .eq("id", taskId)
        .maybeSingle();
      return {
        project_id: data?.project_id ?? null,
        team_id: data?.team_id ?? null,
      };
    },
  });
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: teams = [] } = useQuery(teamsQueryOptions(propertyId));

  const project = projects.find((p) => p.id === assign?.project_id) ?? null;
  const team = teams.find((t) => t.id === assign?.team_id) ?? null;

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
  async function pickTeam(teamId: string | null) {
    const res = await setTaskTeam(taskId, teamId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

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
              <span className={cn("size-2.5 rounded", DOT[project.color])} />
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
              <span className={cn("size-2.5 rounded", DOT[p.color])} />
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
              className={cn(ROW, team ? "text-foreground" : "text-muted-foreground")}
            />
          }
        >
          <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
            <Users className={team ? textDot(team.color) : "size-3.5"} />
          </span>
          <span className="truncate">{team ? team.name : "Team"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-y-auto">
          <DropdownMenuItem onClick={() => void pickTeam(null)}>
            No team
          </DropdownMenuItem>
          {teams.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => void pickTeam(t.id)}
              className="gap-2"
            >
              <span className={cn("size-2.5 rounded-full", DOT[t.color])} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.id === team?.id ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function textDot(color: EntityColor): string {
  return {
    slate: "size-3.5 text-slate-500",
    blue: "size-3.5 text-blue-500",
    green: "size-3.5 text-emerald-500",
    amber: "size-3.5 text-amber-500",
    rose: "size-3.5 text-rose-500",
    violet: "size-3.5 text-violet-500",
  }[color];
}
