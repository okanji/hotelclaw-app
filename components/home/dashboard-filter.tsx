"use client";

import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  projectsQueryOptions,
  teamsQueryOptions,
} from "@/lib/query/project-queries";
import type { EntityColor } from "@/lib/db/types";

export type DashboardFilter =
  | { kind: "all" }
  | { kind: "team"; id: string }
  | { kind: "project"; id: string };

const DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

const FilterContext = createContext<DashboardFilter>({ kind: "all" });

export function DashboardFilterProvider({
  value,
  children,
}: {
  value: DashboardFilter;
  children: React.ReactNode;
}) {
  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  );
}

export function useDashboardFilter() {
  return useContext(FilterContext);
}

/** Filter a task list by the active dashboard scope (team / project / all). */
export function applyTaskFilter<
  T extends { team_id?: string | null; project_id?: string | null },
>(tasks: T[], filter: DashboardFilter): T[] {
  if (filter.kind === "all") return tasks;
  if (filter.kind === "team")
    return tasks.filter((t) => t.team_id === filter.id);
  return tasks.filter((t) => t.project_id === filter.id);
}

/** Header control to pick the dashboard scope. */
export function DashboardFilterMenu({
  propertyId,
  value,
  onChange,
}: {
  propertyId: string;
  value: DashboardFilter;
  onChange: (next: DashboardFilter) => void;
}) {
  const { data: teams = [] } = useQuery(teamsQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));

  const label =
    value.kind === "all"
      ? "All work"
      : value.kind === "team"
        ? (teams.find((t) => t.id === value.id)?.name ?? "Team")
        : (projects.find((p) => p.id === value.id)?.name ?? "Project");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" size="sm" variant="ghost">
            <ListFilter className="size-4" />
            {label}
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-56">
        <DropdownMenuItem onClick={() => onChange({ kind: "all" })}>
          <span className="flex-1">All work</span>
          {value.kind === "all" ? <Check className="size-3.5" /> : null}
        </DropdownMenuItem>
        {projects.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[0.6875rem] tracking-wider text-muted-foreground uppercase">
              Projects
            </DropdownMenuLabel>
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => onChange({ kind: "project", id: p.id })}
                className="gap-2"
              >
                <span className={cn("size-2 rounded", DOT[p.color])} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {value.kind === "project" && value.id === p.id ? (
                  <Check className="size-3.5" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
        {teams.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[0.6875rem] tracking-wider text-muted-foreground uppercase">
              Teams
            </DropdownMenuLabel>
            {teams.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => onChange({ kind: "team", id: t.id })}
                className="gap-2"
              >
                <span className={cn("size-2 rounded-full", DOT[t.color])} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {value.kind === "team" && value.id === t.id ? (
                  <Check className="size-3.5" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
