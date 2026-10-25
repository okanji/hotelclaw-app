"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronRight,
  FileText,
  FolderKanban,
  GanttChart,
  LayoutDashboard,
  ListChecks,
  Plus,
  Sun,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import type { EntityColor } from "@/lib/db/types";
import { LABEL_INK } from "@/components/labels/label-tokens";
import { useOpenSpace } from "@/lib/spaces/use-open-space";
import { useOpenProject } from "@/lib/projects/use-open-project";
import { CreateEntityDialog } from "./create-entity-dialog";
import { LABEL_DOT } from "@/components/labels/label-tokens";

const DOT = LABEL_DOT;

/**
 * Spaces + Projects lists for the Home sidebar. Spaces are departments (F&B,
 * Maintenance); Projects are cross-space initiatives (Festival, Wedding).
 * Property-scoped, live-updating; the `+` actions open the create modal.
 *
 * This is the ONE place teams and projects live as destinations (gr8r /
 * ClickUp model): each row expands into its workspace views, which deep-link
 * the page's `?tab=` (see `useUrlTab`). The Tasks sidebar only offers them as
 * board filters.
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
      .channel(`projects-sidebar:${propertyId}:${Math.random().toString(36).slice(2)}`)
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

  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const [expanded, toggleExpanded] = useExpandedIds();

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Teams</SidebarGroupLabel>
        <SidebarGroupAction
          title="New team"
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
                <EntityRow
                  key={s.id}
                  href={`/p/${propertyId}/spaces/${s.id}`}
                  name={s.name}
                  icon={
                    s.icon ? (
                      <span aria-hidden="true">{s.icon}</span>
                    ) : (
                      <Users className={textColor(s.color)} />
                    )
                  }
                  active={pathname.includes(`/spaces/${s.id}`)}
                  activeTab={tab}
                  views={SPACE_VIEWS}
                  expanded={expanded.has(s.id)}
                  onToggle={() => toggleExpanded(s.id)}
                  onOpen={(view) => openSpace(s.id, view)}
                />
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
              No projects yet. Create one to group work across teams.
            </p>
          ) : (
            <SidebarMenu>
              {projects.map((p) => (
                <EntityRow
                  key={p.id}
                  href={`/p/${propertyId}/projects/${p.id}`}
                  name={p.name}
                  icon={
                    p.icon ? (
                      <span aria-hidden="true">{p.icon}</span>
                    ) : (
                      <span
                        className={cn("size-2 shrink-0 rounded-[3px]", DOT[p.color])}
                        aria-hidden="true"
                      />
                    )
                  }
                  active={pathname.includes(`/projects/${p.id}`)}
                  activeTab={tab}
                  views={PROJECT_VIEWS}
                  expanded={expanded.has(p.id)}
                  onToggle={() => toggleExpanded(p.id)}
                  onOpen={(view) => openProject(p.id, view)}
                />
              ))}
            </SidebarMenu>
          )}
          {/* Footer rows (gr8r ends its Projects group the same way). Both
              pages were otherwise reachable only from breadcrumbs. */}
          <SidebarMenu className="mt-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`/p/${propertyId}/projects`} />}
                isActive={pathname === `/p/${propertyId}/projects`}
                tooltip="All projects"
                className="text-faint-foreground"
              >
                <FolderKanban />
                <span>All projects</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`/p/${propertyId}/archive`} />}
                isActive={pathname.startsWith(`/p/${propertyId}/archive`)}
                tooltip="Archive"
                className="text-faint-foreground"
              >
                <Archive />
                <span>Archive</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
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
  return LABEL_INK[color];
}

type EntityView = { tab: string; label: string; icon: typeof Users };

/** Sub-views shown under an expanded row — ids are the workspace tab ids in
 *  project-detail.tsx / space-detail.tsx (the first is the default tab). */
const PROJECT_VIEWS: EntityView[] = [
  { tab: "overview", label: "Overview", icon: LayoutDashboard },
  { tab: "tasks", label: "Tasks", icon: ListChecks },
  { tab: "timeline", label: "Timeline", icon: GanttChart },
  { tab: "docs", label: "Docs", icon: FileText },
];
const SPACE_VIEWS: EntityView[] = [
  { tab: "overview", label: "Overview", icon: LayoutDashboard },
  { tab: "daily-ops", label: "Daily ops", icon: Sun },
  { tab: "issues", label: "Tasks", icon: ListChecks },
  { tab: "docs", label: "Docs", icon: FileText },
];

/** Plain left clicks are intercepted for the pushState fast path; modified
 *  clicks fall through to the real link (new tab, etc.). */
function isPlainClick(e: React.MouseEvent) {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0);
}

function EntityRow({
  href,
  name,
  icon,
  active,
  activeTab,
  views,
  expanded,
  onToggle,
  onOpen,
}: {
  href: string;
  name: string;
  icon: React.ReactNode;
  active: boolean;
  activeTab: string | null;
  views: EntityView[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (tab?: string) => void;
}) {
  // The open entity always shows its views, so you can see which one you're on.
  const open = expanded || active;
  const currentTab = activeTab ?? views[0].tab;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <Link
            href={href}
            onClick={(e) => {
              if (!isPlainClick(e)) return;
              e.preventDefault();
              onOpen();
            }}
          />
        }
        // Row itself reads active only when collapsed — once expanded, the
        // highlighted sub-view carries "you are here".
        isActive={active && !open}
        tooltip={name}
        className="pr-7"
      >
        {icon}
        <span className="truncate">{name}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        onClick={onToggle}
        aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
        aria-expanded={open}
        disabled={active}
      >
        <ChevronRight
          className={cn("transition-transform", open && "rotate-90")}
        />
      </SidebarMenuAction>
      {open ? (
        <SidebarMenuSub>
          {views.map((v) => {
            const Icon = v.icon;
            const viewHref =
              v.tab === views[0].tab ? href : `${href}?tab=${v.tab}`;
            return (
              <SidebarMenuSubItem key={v.tab}>
                <SidebarMenuSubButton
                  render={
                    <Link
                      href={viewHref}
                      onClick={(e) => {
                        if (!isPlainClick(e)) return;
                        e.preventDefault();
                        onOpen(v.tab === views[0].tab ? undefined : v.tab);
                      }}
                    />
                  }
                  isActive={active && currentTab === v.tab}
                >
                  <Icon />
                  <span>{v.label}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

const EXPANDED_KEY = "hotelclaw:sidebar-expanded";

/** Which team/project rows the user has expanded — remembered per browser. */
function useExpandedIds(): [Set<string>, (id: string) => void] {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Storage unavailable — rows just start collapsed.
    }
  }, []);
  const toggle = (id: string) =>
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // Ignore — preference only.
      }
      return next;
    });
  return [ids, toggle];
}
