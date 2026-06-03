"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  projectsQueryOptions,
  teamsQueryOptions,
} from "@/lib/query/project-queries";
import type { EntityColor, ProjectStatus } from "@/lib/db/types";
import { createProject } from "./actions";

const COLOR_DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};
const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  planned: "Planned",
  completed: "Completed",
  archived: "Archived",
};

export function ProjectsIndex({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const teamFilter = searchParams.get("team");

  const { data: projects = [], isPending } = useQuery(
    projectsQueryOptions(propertyId),
  );
  const { data: teams = [] } = useQuery(teamsQueryOptions(propertyId));
  const [creating, setCreating] = useState(false);

  // When filtering by team, fetch that team's project ids.
  const { data: teamProjectIds } = useQuery({
    queryKey: ["team-project-ids", teamFilter] as const,
    enabled: !!teamFilter,
    queryFn: async (): Promise<string[]> => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("project_teams")
        .select("project_id")
        .eq("team_id", teamFilter as string);
      return (data ?? []).map((r) => r.project_id);
    },
  });

  const teamName = teamFilter
    ? teams.find((t) => t.id === teamFilter)?.name
    : null;

  const shown = useMemo(() => {
    if (!teamFilter) return projects;
    const ids = new Set(teamProjectIds ?? []);
    return projects.filter((p) => ids.has(p.id));
  }, [projects, teamFilter, teamProjectIds]);

  async function handleCreate() {
    setCreating(true);
    const res = await createProject(propertyId, "New project");
    setCreating(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["projects", propertyId] });
    router.push(`/p/${propertyId}/projects/${res.id}`);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <header className="flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {teamName ? `Team · ${teamName}` : "Workspace"}
            </p>
            <h1 className="text-[2.5rem] leading-none font-semibold tracking-tight text-foreground">
              Projects
            </h1>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            New project
          </Button>
        </div>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed tracking-tight text-pretty text-muted-foreground">
          Cross-team initiatives — group the tasks and documents for something
          like a Festival or a Wedding in one place.
        </p>
      </header>

      <hr className="my-10 border-border" />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {teamName
              ? `No projects involve ${teamName} yet.`
              : "No projects yet."}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={handleCreate}>
            <Plus className="size-4" />
            New project
          </Button>
        </div>
      ) : (
        <ul
          role="list"
          className="flex flex-col divide-y divide-border/40 border-t border-border/40"
        >
          {shown.map((p) => (
            <li key={p.id}>
              <Link
                href={`/p/${propertyId}/projects/${p.id}`}
                className="flex items-center gap-3 rounded-md px-2 py-3.5 transition-colors hover:bg-muted"
              >
                <span
                  className={cn("size-2.5 shrink-0 rounded", COLOR_DOT[p.color])}
                  aria-hidden="true"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[0.9375rem] font-medium tracking-tight text-foreground">
                    {p.name}
                  </span>
                  {p.description ? (
                    <span className="truncate text-[0.8125rem] tracking-tight text-muted-foreground">
                      {p.description}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[0.75rem] tracking-tight text-muted-foreground">
                  {STATUS_LABEL[p.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
