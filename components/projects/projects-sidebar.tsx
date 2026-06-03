"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Users } from "lucide-react";
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
  teamsQueryOptions,
} from "@/lib/query/project-queries";
import type { EntityColor } from "@/lib/db/types";
import { createProject, createTeam } from "./actions";

const DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

/**
 * Teams + Projects lists for the Home sidebar. Teams are departments (F&B,
 * Maintenance); Projects are cross-team initiatives (Festival, Wedding).
 * Property-scoped, live-updating, with one-tap create. Clicking a project opens
 * its page; clicking a team filters the projects index to that team.
 */
export function ProjectsSidebar({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data: teams = [] } = useQuery(teamsQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const [creating, setCreating] = useState<"team" | "project" | null>(null);

  // Live updates — teams + projects are in the realtime publication.
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
          table: "teams",
          filter: `property_id=eq.${propertyId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["teams", propertyId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);

  async function handleCreateProject() {
    setCreating("project");
    const res = await createProject(propertyId, "New project");
    setCreating(null);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["projects", propertyId] });
    router.push(`/p/${propertyId}/projects/${res.id}`);
  }

  async function handleCreateTeam() {
    setCreating("team");
    const res = await createTeam(propertyId, "New team");
    setCreating(null);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["teams", propertyId] });
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarGroupAction
          title="New project"
          onClick={handleCreateProject}
          disabled={creating !== null}
        >
          {creating === "project" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Plus />
          )}
        </SidebarGroupAction>
        <SidebarGroupContent>
          {projects.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-pretty text-sidebar-foreground/60">
              No projects yet. Create one to group work across teams.
            </p>
          ) : (
            <SidebarMenu>
              {projects.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    render={
                      <Link href={`/p/${propertyId}/projects/${p.id}`} />
                    }
                    isActive={pathname.includes(`/projects/${p.id}`)}
                    tooltip={p.name}
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-[3px]",
                        DOT[p.color],
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{p.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Teams</SidebarGroupLabel>
        <SidebarGroupAction
          title="New team"
          onClick={handleCreateTeam}
          disabled={creating !== null}
        >
          {creating === "team" ? <Loader2 className="animate-spin" /> : <Plus />}
        </SidebarGroupAction>
        <SidebarGroupContent>
          {teams.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-pretty text-sidebar-foreground/60">
              Add departments like F&amp;B or Maintenance.
            </p>
          ) : (
            <SidebarMenu>
              {teams.map((t) => (
                <SidebarMenuItem key={t.id}>
                  <SidebarMenuButton
                    render={
                      <Link
                        href={`/p/${propertyId}/projects?team=${t.id}`}
                      />
                    }
                    tooltip={t.name}
                  >
                    <Users className={textDot(t.color)} />
                    <span className="truncate">{t.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

/** Tint the Users glyph by team color (stroke uses currentColor). */
function textDot(color: EntityColor): string {
  return {
    slate: "text-slate-500",
    blue: "text-blue-500",
    green: "text-emerald-500",
    amber: "text-amber-500",
    rose: "text-rose-500",
    violet: "text-violet-500",
  }[color];
}
