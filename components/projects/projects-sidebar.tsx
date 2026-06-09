"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import type { EntityColor } from "@/lib/db/types";
import { useOpenSpace } from "@/lib/spaces/use-open-space";
import { useOpenProject } from "@/lib/projects/use-open-project";
import { CreateEntityDialog } from "./create-entity-dialog";

const DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

/**
 * Spaces + Projects lists for the Home sidebar. Spaces are departments (F&B,
 * Maintenance); Projects are cross-space initiatives (Festival, Wedding).
 * Property-scoped, live-updating; the `+` actions open the create modal.
 */
export function ProjectsSidebar({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const openSpace = useOpenSpace(propertyId);
  const openProject = useOpenProject(propertyId);
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const [dialog, setDialog] = useState<{
    open: boolean;
    kind: "space" | "project";
  }>({ open: false, kind: "project" });

  // Live updates — spaces + projects are in the realtime publication.
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`projects-sidebar:${propertyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "projects",
          filter: `property_id=eq.${propertyId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["projects", propertyId] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "spaces",
          filter: `property_id=eq.${propertyId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["spaces", propertyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Spaces</SidebarGroupLabel>
        <SidebarGroupAction
          title="New space"
          onClick={() => setDialog({ open: true, kind: "space" })}
        >
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          {spaces.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-pretty text-sidebar-foreground/60">
              Add departments like F&amp;B or Maintenance.
            </p>
          ) : (
            <SidebarMenu>
              {spaces.map((s) => (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton
                    render={
                      <Link
                        href={`/p/${propertyId}/spaces/${s.id}`}
                        onClick={(e) => {
                          if (
                            e.metaKey ||
                            e.ctrlKey ||
                            e.shiftKey ||
                            e.button !== 0
                          )
                            return;
                          e.preventDefault();
                          openSpace(s.id);
                        }}
                      />
                    }
                    isActive={pathname.includes(`/spaces/${s.id}`)}
                    tooltip={s.name}
                  >
                    {s.icon ? (
                      <span aria-hidden="true">{s.icon}</span>
                    ) : (
                      <Users className={textColor(s.color)} />
                    )}
                    <span className="truncate">{s.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarGroupAction
          title="New project"
          onClick={() => setDialog({ open: true, kind: "project" })}
        >
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          {projects.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-pretty text-sidebar-foreground/60">
              No projects yet. Create one to group work across spaces.
            </p>
          ) : (
            <SidebarMenu>
              {projects.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    render={
                      <Link
                        href={`/p/${propertyId}/projects/${p.id}`}
                        onClick={(e) => {
                          if (
                            e.metaKey ||
                            e.ctrlKey ||
                            e.shiftKey ||
                            e.button !== 0
                          )
                            return;
                          e.preventDefault();
                          openProject(p.id);
                        }}
                      />
                    }
                    isActive={pathname.includes(`/projects/${p.id}`)}
                    tooltip={p.name}
                  >
                    {p.icon ? (
                      <span aria-hidden="true">{p.icon}</span>
                    ) : (
                      <span
                        className={cn("size-2 shrink-0 rounded-[3px]", DOT[p.color])}
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{p.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <CreateEntityDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        propertyId={propertyId}
        kind={dialog.kind}
      />
    </>
  );
}

/** Tint the Users glyph by space color (stroke uses currentColor). */
function textColor(color: EntityColor): string {
  return {
    slate: "text-slate-500",
    blue: "text-blue-500",
    green: "text-emerald-500",
    amber: "text-amber-500",
    rose: "text-rose-500",
    violet: "text-violet-500",
  }[color];
}
