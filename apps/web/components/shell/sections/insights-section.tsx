"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, FolderKanban, Sparkles, User, Users } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { scopeKey, type InsightScope } from "@/lib/insights/scope";
import { useInsightsTab } from "@/components/insights/insights-tab-context";

/**
 * Secondary sidebar for the Insights section. The dashboard VIEWS
 * (Overview / Work / Operations / Reports) now live in an in-page red-underline
 * tab strip on the surface itself; the sidebar carries the other axis — the
 * LENS the whole page reads through (the property, one project, one team, or
 * one person), shared with the surface via `useInsightsTab`. Staff never get
 * either: the whole surface is their personal "My week", labelled here.
 */
export function InsightsSection({
  propertyId,
  isManagement,
}: {
  propertyId: string;
  isManagement: boolean;
}) {
  if (!isManagement) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive tooltip="My week">
                <Sparkles />
                <span>My week</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return <ScopeNav propertyId={propertyId} />;
}

function ScopeNav({ propertyId }: { propertyId: string }) {
  const { scope, setScope } = useInsightsTab();
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const activeKey = scopeKey(scope);

  const row = (
    label: string,
    Icon: typeof Building2,
    next: InsightScope,
  ) => (
    <SidebarMenuItem key={scopeKey(next)}>
      <SidebarMenuButton
        render={<button type="button" />}
        onClick={() => setScope(next)}
        isActive={scopeKey(next) === activeKey}
        tooltip={label}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Lens</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {row("Whole property", Building2, { kind: "property" })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {projects.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((p) =>
                row(p.name, FolderKanban, { kind: "project", id: p.id }),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}

      {spaces.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Teams</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {spaces.map((s) =>
                row(s.name, Users, { kind: "space", id: s.id }),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}

      {members.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>People</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {members.map((m) =>
                row(m.name ?? "Unknown", User, { kind: "person", id: m.id }),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}
