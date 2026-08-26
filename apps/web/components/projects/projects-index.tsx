"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarRange, Columns3, Plus, Table2 } from "lucide-react";
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
import {
  EMPTY_PROJECT_FILTERS,
  ProjectsFilterBar,
  hasAnyProjectFacet,
  matchesProjectFilters,
  type ProjectsFilters,
} from "./projects-filters";

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
  const spaceParam = searchParams.get("space");
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

  // Deep links from the sidebar (`?space=<id>`) seed the Team facet, so a
  // linked-in scope shows up as a removable chip like any other filter.
  const [filters, setFilters] = useState<ProjectsFilters>(() =>
    spaceParam
      ? { ...EMPTY_PROJECT_FILTERS, spaceIds: [spaceParam] }
      : EMPTY_PROJECT_FILTERS,
  );
  useEffect(() => {
    if (!spaceParam) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters((f) =>
      f.spaceIds.includes(spaceParam)
        ? f
        : { ...f, spaceIds: [...f.spaceIds, spaceParam] },
    );
  }, [spaceParam]);
  function changeFilters(next: ProjectsFilters) {
    setFilters(next);
    // Dropping the linked-in team from the facet also strips the URL param —
    // otherwise a reload silently re-applies the filter the user just removed.
    if (spaceParam && !next.spaceIds.includes(spaceParam)) {
      const url = new URL(window.location.href);
      url.searchParams.delete("space");
      window.history.replaceState(null, "", url);
    }
  }

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

  // Teams involved per project — chips on every view's rows/cards, and the
  // Team facet's matching input.
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
  const spaceIdsByProject = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const pair of projectSpacePairs) {
      const list = map.get(pair.project_id) ?? [];
      list.push(pair.space_id);
      map.set(pair.project_id, list);
    }
    return map;
  }, [projectSpacePairs]);

  // Reference "now" for the target-date buckets — captured once (day-grain
  // buckets don't need a ticking clock), same as the tasks board.
  const [now] = useState(() => Date.now());
  const filtering = hasAnyProjectFacet(filters);
  const shown = useMemo(() => {
    if (!filtering) return projects;
    return projects.filter((p) =>
      matchesProjectFilters(p, filters, spaceIdsByProject, now),
    );
  }, [projects, filters, filtering, spaceIdsByProject, now]);

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
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
            <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
            <ProjectsFilterBar
              filters={filters}
              onChange={changeFilters}
              data={{ spaces, members: memberList }}
            />
          </div>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {filtering
              ? `${shown.length} of ${projects.length}`
              : shown.length}{" "}
            {(filtering ? projects.length : shown.length) === 1
              ? "project"
              : "projects"}
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
                {filtering
                  ? "No projects match the current filters."
                  : "No projects yet."}
              </p>
              {filtering ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => changeFilters(EMPTY_PROJECT_FILTERS)}
                >
                  Clear filters
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="size-4" />
                  New project
                </Button>
              )}
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
