"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
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
import type { EntityColor } from "@/lib/db/types";
import { LABEL_DOT } from "@/components/labels/label-tokens";

const DOT = LABEL_DOT;

/**
 * Secondary-sidebar content for the Tasks section: saved views over the same
 * board. Besides "All / My tasks", each Space and Project is a saved view that
 * scopes the board via `?space=`/`?project=` (read by `board.tsx`).
 *
 * Uses `useSearchParams` for the active highlight — wrap in `<Suspense>`.
 */
export function TasksSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/p/${propertyId}/tasks`;
  const onTasks = pathname === base || pathname.startsWith(`${base}/`);
  const mine = searchParams.get("view") === "mine";
  const activeSpace = searchParams.get("space");
  const activeProject = searchParams.get("project");
  const scoped = mine || !!activeSpace || !!activeProject;

  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Tasks</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={base} />}
                isActive={onTasks && !scoped}
                tooltip="All tasks"
              >
                <LayoutGrid />
                <span>All tasks</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`${base}?view=mine`} />}
                isActive={onTasks && mine}
                tooltip="My tasks"
              >
                <UserCheck />
                <span>My tasks</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {spaces.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Spaces</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {spaces.map((s) => (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton
                    render={<Link href={`${base}?space=${s.id}`} />}
                    isActive={onTasks && activeSpace === s.id}
                    tooltip={s.name}
                  >
                    {s.icon ? (
                      <span aria-hidden="true">{s.icon}</span>
                    ) : (
                      <span
                        className={cn("size-2 rounded-full", DOT[s.color])}
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{s.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}

      {projects.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    render={<Link href={`${base}?project=${p.id}`} />}
                    isActive={onTasks && activeProject === p.id}
                    tooltip={p.name}
                  >
                    {p.icon ? (
                      <span aria-hidden="true">{p.icon}</span>
                    ) : (
                      <span
                        className={cn("size-2 rounded-[3px]", DOT[p.color])}
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{p.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}
