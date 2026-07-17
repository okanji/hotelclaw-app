"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
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
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { scopeKey, type InsightScope } from "@/lib/insights/scope";

/**
 * The Insights lens — switch the whole page (metrics, charts, AI brief)
 * between the property, one project, one space (team), or one person.
 * Management only: staff sessions never render this (they get My Week).
 */
export function ScopeSwitcher({
  propertyId,
  scope,
  onChange,
}: {
  propertyId: string;
  scope: InsightScope;
  onChange: (scope: InsightScope) => void;
}) {
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  const currentLabel =
    scope.kind === "property"
      ? "Whole property"
      : scope.kind === "project"
        ? (projects.find((p) => p.id === scope.id)?.name ?? "Project")
        : scope.kind === "space"
          ? (spaces.find((s) => s.id === scope.id)?.name ?? "Team")
          : (members.find((m) => m.id === scope.id)?.name ?? "Person");

  const activeKey = scopeKey(scope);
  const item = (label: string, next: InsightScope) => (
    <DropdownMenuItem
      key={scopeKey(next)}
      onClick={() => onChange(next)}
      className="gap-2"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {scopeKey(next) === activeKey ? <Check className="size-3.5" /> : null}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" />}
      >
        <span className="max-w-48 truncate">{currentLabel}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="max-h-96 w-60 overflow-y-auto">
        {item("Whole property", { kind: "property" })}
        {projects.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {projects.map((p) => item(p.name, { kind: "project", id: p.id }))}
          </DropdownMenuGroup>
        ) : null}
        {spaces.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Teams</DropdownMenuLabel>
            {spaces.map((s) => item(s.name, { kind: "space", id: s.id }))}
          </DropdownMenuGroup>
        ) : null}
        {members.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>People</DropdownMenuLabel>
            {members.map((m) =>
              item(m.name ?? "Unknown", { kind: "person", id: m.id }),
            )}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
