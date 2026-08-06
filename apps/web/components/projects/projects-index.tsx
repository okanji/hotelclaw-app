"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarRange, Columns3, Plus, Table2 } from "lucide-react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import { SectionHeader } from "@/components/ui/section-header";
import { PageShell } from "@/components/ui/page-shell";
import {
  projectSpacesQueryOptions,
  projectsTrackingQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { CreateEntityDialog } from "./create-entity-dialog";
import {
  type ProjectMember,
  type ProjectTeam,
  type ProjectsViewMode,
} from "./tracking/tracking-shared";
import { ProjectsBoardView } from "./tracking/board-view";
import { ProjectsTableView } from "./tracking/table-view";
import { ProjectsTimelineView } from "./tracking/timeline-view";

const VIEW_TABS: {
  id: ProjectsViewMode;
  label: string;
  Icon: typeof Columns3;
}[] = [
  { id: "table", label: "Table", Icon: Table2 },
  { id: "board", label: "Board", Icon: Columns3 },
  { id: "timeline", label: "Timeline", Icon: CalendarRange },
];

const VIEW_STORAGE_KEY = "projects:view";

export function ProjectsIndex({ propertyId }: { propertyId: string }) {
  const searchParams = useSearchParams();
  const spaceFilter = searchParams.get("space");
  const qc = useQueryClient();

  const { data: projects = [], isPending } = useQuery(
    projectsTrackingQueryOptions(propertyId),
  );
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<ProjectsViewMode>("table");

  // Restore the last-used view (client-only; avoids a hydration mismatch).
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "board" || saved === "table" || saved === "timeline") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView(saved);
    }
  }, []);
  function changeView(next: ProjectsViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  // When filtering by space, fetch that space's project ids.
  const { data: spaceProjectIds } = useQuery({
    queryKey: ["space-project-ids", spaceFilter] as const,
    enabled: !!spaceFilter,
    queryFn: async (): Promise<string[]> => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("project_spaces")
        .select("project_id")
        .eq("space_id", spaceFilter as string);
      return (data ?? []).map((r) => r.project_id);
    },
  });

  const spaceName = spaceFilter
    ? spaces.find((t) => t.id === spaceFilter)?.name
    : null;

  // Teams involved per project — chips on every view's rows/cards.
  const { data: projectSpacePairs = [] } = useQuery(
    projectSpacesQueryOptions(propertyId),
  );
  const teamsByProject = useMemo(() => {
    const spaceById = new Map(spaces.map((s) => [s.id, s]));
    const map = new Map<string, ProjectTeam[]>();
    for (const pair of projectSpacePairs) {
      const space = spaceById.get(pair.space_id);
      if (!space) continue;
      const list = map.get(pair.project_id) ?? [];
      list.push({ id: space.id, name: space.name, color: space.color });
      map.set(pair.project_id, list);
    }
    return map;
  }, [projectSpacePairs, spaces]);

  const shown = useMemo(() => {
    if (!spaceFilter) return projects;
    const ids = new Set(spaceProjectIds ?? []);
    return projects.filter((p) => ids.has(p.id));
  }, [projects, spaceFilter, spaceProjectIds]);

  const memberList: ProjectMember[] = members;

  function onChanged() {
    void qc.invalidateQueries({
      queryKey: ["projects-tracking", propertyId],
    });
    void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
  }

  const viewProps = {
    propertyId,
    projects: shown,
    members: memberList,
    teamsByProject,
    onChanged,
  };

  /*
   * WIDTH — `bleed`, for the whole page. Two of the three views (board,
   * timeline) are data canvases that want the pane, and all three share this
   * masthead and tab strip, so one full-width edge keeps the page from
   * shifting sideways when the view changes.
   */
  return (
    <PageShell width="bleed" className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-col gap-5 border-b border-border px-8 pt-12 pb-5 sm:px-14 sm:pt-14">
        <SectionHeader
          size="page"
          title="Projects"
          actions={<>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title="Archive"
              aria-label="Archive"
              render={<Link href={`/p/${propertyId}/archive`} />}
            >
              <Archive className="size-4" />
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New project
            </Button>
          </>}
        />

        <div className="flex items-center justify-between gap-4">
          <TabNav variant="pill" aria-label="Project views">
            {VIEW_TABS.map((t) => (
              <TabNavItem
                key={t.id}
                active={view === t.id}
                onClick={() => changeView(t.id)}
              >
                <t.Icon />
                {t.label}
              </TabNavItem>
            ))}
          </TabNav>
          <span className="text-sm tabular-nums text-muted-foreground">
            {shown.length} {shown.length === 1 ? "project" : "projects"}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isPending ? (
          <p className="px-8 pt-10 text-sm text-muted-foreground sm:px-14">
            Loading projects…
          </p>
        ) : shown.length === 0 ? (
          <div className="px-8 pt-10 sm:px-14">
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {spaceName
                  ? `No projects involve ${spaceName} yet.`
                  : "No projects yet."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
                New project
              </Button>
            </div>
          </div>
        ) : view === "board" ? (
          <ProjectsBoardView {...viewProps} />
        ) : view === "timeline" ? (
          <ProjectsTimelineView {...viewProps} />
        ) : (
          <ProjectsTableView {...viewProps} />
        )}
      </div>

      <CreateEntityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        propertyId={propertyId}
        kind="project"
      />
    </PageShell>
  );
}
