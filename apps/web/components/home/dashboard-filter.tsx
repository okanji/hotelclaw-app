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
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import type { EntityColor } from "@/lib/db/types";
import { LABEL_DOT } from "@/components/labels/label-tokens";

export type DashboardFilter =
  | { kind: "all" }
  | { kind: "space"; id: string }
  | { kind: "project"; id: string };

const DOT = LABEL_DOT;

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

/** Filter a task list by the active dashboard scope (space / project / all). */
export function applyTaskFilter<
  T extends { space_id?: string | null; project_id?: string | null },
>(tasks: T[], filter: DashboardFilter): T[] {
  if (filter.kind === "all") return tasks;
  if (filter.kind === "space")
    return tasks.filter((t) => t.space_id === filter.id);
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
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));

  const label =
    value.kind === "all"
      ? "All work"
      : value.kind === "space"
        ? (spaces.find((t) => t.id === value.id)?.name ?? "Team")
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
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => onChange({ kind: "project", id: p.id })}
                className="gap-2"
              >
                <span className={cn("size-2 rounded-sm", DOT[p.color])} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {value.kind === "project" && value.id === p.id ? (
                  <Check className="size-3.5" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
        {spaces.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Teams</DropdownMenuLabel>
            {spaces.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => onChange({ kind: "space", id: t.id })}
                className="gap-2"
              >
                <span className={cn("size-2 rounded-full", DOT[t.color])} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {value.kind === "space" && value.id === t.id ? (
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
