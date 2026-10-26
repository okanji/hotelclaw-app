"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Columns3,
  FolderKanban,
  GanttChart,
  List,
  PanelRight,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader, PageHeaderRow } from "@/components/shell/page-header";
import { PageShell } from "@/components/ui/page-shell";
import {
  projectSpacesQueryOptions,
  projectsTrackingQueryOptions,
  spacesQueryOptions,
  type ProjectTracking,
} from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { declaredHealthQueryOptions } from "@/lib/query/initiative-queries";
import {
  propertyMilestonesQueryOptions,
  type PropertyMilestone,
} from "@/lib/query/milestone-queries";
import { CreateEntityDialog } from "./create-entity-dialog";
import {
  COLOR_DOT,
  type ProjectMember,
  type ProjectTeam,
} from "./tracking/tracking-shared";
import { ProjectsBoardView } from "./tracking/board-view";
import { ProjectsListView } from "./tracking/list-view";
import { ProjectsTimelineView } from "./tracking/timeline-view";
import {
  HEALTH_LABEL,
  HealthIcon,
  LIST_PROPERTIES,
  OptionMenu,
  type EffectiveHealth,
  type ProjectsDisplay,
  type ProjectsGrouping,
  type ProjectsLayout,
  type ProjectsOrdering,
  effectiveHealth,
  groupProjects,
  useProjectsDisplay,
} from "./tracking/project-display";
import {
  EMPTY_PROJECT_FILTERS,
  ProjectsFilterBar,
  hasAnyProjectFacet,
  matchesProjectFilters,
  type ProjectsFilters,
} from "./projects-filters";

const LAYOUTS: { id: ProjectsLayout; label: string; Icon: typeof List }[] = [
  { id: "list", label: "List", Icon: List },
  { id: "board", label: "Board", Icon: Columns3 },
  { id: "timeline", label: "Timeline", Icon: GanttChart },
];
const GROUPINGS: { id: ProjectsGrouping; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "health", label: "Health" },
  { id: "lead", label: "Lead" },
  { id: "none", label: "No grouping" },
];
const ORDERINGS: { id: ProjectsOrdering; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "target", label: "Target date" },
  { id: "progress", label: "Progress" },
];

/** The summary panel's lens — clicking a row narrows the page to it. */
type Focus = { kind: "health"; key: EffectiveHealth } | { kind: "team" | "lead"; key: string };

/**
 * The Projects page, modelled on Linear's (`linear.app/demo/projects/all`):
 * a compact header, the "All projects" view chip + filters, and on the right
 * Display options (layout List / Board / Timeline, grouping, ordering,
 * closed projects, list properties) and the Health / Teams / Leads summary
 * panel. Timeline is the default layout, like Linear's.
 */
export function ProjectsIndex({ propertyId }: { propertyId: string }) {
  const searchParams = useSearchParams();
  const spaceParam = searchParams.get("space");
  const qc = useQueryClient();
  const { display, update, reset } = useProjectsDisplay();

  const { data: projects = [], isPending } = useQuery(projectsTrackingQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: declared } = useQuery(declaredHealthQueryOptions(propertyId));
  const { data: milestones = [] } = useQuery(propertyMilestonesQueryOptions(propertyId));
  const [createOpen, setCreateOpen] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);

  // Deep links from the sidebar (`?space=<id>`) seed the Team facet, so a
  // linked-in scope shows up as a removable chip like any other filter.
  const [filters, setFilters] = useState<ProjectsFilters>(() =>
    spaceParam ? { ...EMPTY_PROJECT_FILTERS, spaceIds: [spaceParam] } : EMPTY_PROJECT_FILTERS,
  );
  useEffect(() => {
    if (!spaceParam) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters((f) =>
      f.spaceIds.includes(spaceParam) ? f : { ...f, spaceIds: [...f.spaceIds, spaceParam] },
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

  const { data: projectSpacePairs = [] } = useQuery(projectSpacesQueryOptions(propertyId));
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
  const milestonesByProject = useMemo(() => {
    const map = new Map<string, PropertyMilestone[]>();
    for (const m of milestones) {
      if (!m.project_id) continue;
      const list = map.get(m.project_id) ?? [];
      list.push(m);
      map.set(m.project_id, list);
    }
    return map;
  }, [milestones]);

  // Reference "now" for the target-date buckets — day grain, captured once.
  const [now] = useState(() => Date.now());
  const filtering = hasAnyProjectFacet(filters);
  // Filters + "show closed" — the base set the summary panel counts over.
  const base = useMemo(
    () =>
      projects.filter(
        (p) =>
          (display.showCompleted || p.status !== "completed") &&
          (!filtering || matchesProjectFilters(p, filters, spaceIdsByProject, now)),
      ),
    [projects, display.showCompleted, filtering, filters, spaceIdsByProject, now],
  );
  const shown = useMemo(() => {
    if (!focus) return base;
    return base.filter((p) =>
      focus.kind === "health"
        ? effectiveHealth(p, declared).health === focus.key
        : focus.kind === "lead"
          ? (p.lead_user_id ?? "") === focus.key
          : (spaceIdsByProject.get(p.id) ?? []).includes(focus.key),
    );
  }, [base, focus, declared, spaceIdsByProject]);

  const memberList: ProjectMember[] = members;
  const groups = useMemo(
    () => groupProjects(shown, display, { members: memberList, declared }),
    [shown, display, memberList, declared],
  );

  function onChanged() {
    void qc.invalidateQueries({ queryKey: ["projects-tracking", propertyId] });
    void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
  }

  const viewProps = {
    propertyId,
    projects: shown,
    members: memberList,
    teamsByProject,
    onChanged,
    onCreate: () => setCreateOpen(true),
    groups,
    declared,
    milestonesByProject,
  };

  const narrowed = filtering || !!focus || !display.showCompleted;

  /*
   * WIDTH — `bleed`: the timeline and board are data canvases that want the
   * pane, and every layout shares this header, so one edge keeps the page
   * from shifting sideways when the layout changes.
   */
  return (
    <PageShell width="bleed" className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Projects"
        icon={<FolderKanban />}
        actions={
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Archive"
              aria-label="Archive"
              nativeButton={false}
              render={<Link href={`/p/${propertyId}/archive`} />}
            >
              <Archive className="size-4" />
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New project
            </Button>
          </>
        }
      />
      <PageHeaderRow
        aside={
          <>
            <span className="hidden sm:inline">
              {narrowed ? `${shown.length} of ${projects.length}` : projects.length}{" "}
              {projects.length === 1 ? "project" : "projects"}
            </span>
            <DisplayOptions display={display} update={update} reset={reset} />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-pressed={display.panel}
              aria-label={display.panel ? "Hide summary" : "Show summary"}
              title={display.panel ? "Hide summary" : "Show summary"}
              onClick={() => update({ panel: !display.panel })}
              className={cn(display.panel && "bg-accent text-foreground")}
            >
              <PanelRight className="size-4" />
            </Button>
          </>
        }
      >
        <span className="inline-flex h-7 items-center rounded-full bg-muted px-3 text-sm font-medium text-foreground">
          All projects
        </span>
        <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
        <ProjectsFilterBar
          filters={filters}
          onChange={changeFilters}
          data={{ spaces, members: memberList }}
        />
        {focus ? (
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2 text-sm text-foreground"
          >
            {focusLabel(focus, spaces, memberList)}
            <span aria-hidden className="text-muted-foreground">×</span>
          </button>
        ) : null}
      </PageHeaderRow>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          {isPending ? (
            <p className="px-(--page-gutter) pt-10 text-sm text-muted-foreground">Loading projects…</p>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-(--page-gutter) py-24 text-center">
              <p className="text-sm text-muted-foreground">
                {narrowed ? "No projects match this view." : "No projects yet."}
              </p>
              {narrowed ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    changeFilters(EMPTY_PROJECT_FILTERS);
                    setFocus(null);
                    update({ showCompleted: true });
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  New project
                </Button>
              )}
            </div>
          ) : display.layout === "board" ? (
            <ProjectsBoardView {...viewProps} />
          ) : display.layout === "list" ? (
            <ProjectsListView {...viewProps} />
          ) : (
            <ProjectsTimelineView {...viewProps} />
          )}
        </div>
        {display.panel ? (
          <SummaryPanel
            projects={base}
            declared={declared}
            spaces={spaces}
            members={memberList}
            spaceIdsByProject={spaceIdsByProject}
            focus={focus}
            onFocus={setFocus}
          />
        ) : null}
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

function focusLabel(
  focus: Focus,
  spaces: { id: string; name: string }[],
  members: ProjectMember[],
): string {
  if (focus.kind === "health") return HEALTH_LABEL[focus.key];
  if (focus.kind === "team") return spaces.find((s) => s.id === focus.key)?.name ?? "Team";
  if (!focus.key) return "No lead";
  return members.find((m) => m.id === focus.key)?.name ?? "Member";
}

/** Linear's Display options: layout, grouping, ordering, closed projects and
 *  (for List) which properties show. Persisted per device. */
function DisplayOptions({
  display,
  update,
  reset,
}: {
  display: ProjectsDisplay;
  update: (patch: Partial<ProjectsDisplay>) => void;
  reset: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Display options"
            title="Display options"
          />
        }
      >
        <SlidersHorizontal className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="grid grid-cols-3 gap-1 p-2">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => update({ layout: l.id })}
              aria-pressed={display.layout === l.id}
              className={cn(
                "flex h-8 items-center justify-center gap-1.5 rounded-md border text-sm transition-colors",
                display.layout === l.id
                  ? "border-border bg-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <l.Icon className="size-4" />
              {l.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1 border-t border-border p-3 text-sm">
          <Row label="Grouping">
            <OptionMenu
              label="Grouping"
              value={display.grouping}
              options={GROUPINGS}
              onChange={(grouping) => update({ grouping })}
            />
          </Row>
          <Row label="Ordering">
            <OptionMenu
              label="Ordering"
              value={display.ordering}
              options={ORDERINGS}
              onChange={(ordering) => update({ ordering })}
            />
          </Row>
          <Row label="Show completed projects">
            <Switch
              checked={display.showCompleted}
              onCheckedChange={(v) => update({ showCompleted: v })}
              aria-label="Show completed projects"
            />
          </Row>
        </div>
        {display.layout === "list" ? (
          <div className="border-t border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">Display properties</p>
            <div className="flex flex-wrap gap-1.5">
              {LIST_PROPERTIES.map((prop) => {
                const on = display.properties.includes(prop.id);
                return (
                  <button
                    key={prop.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      update({
                        properties: on
                          ? display.properties.filter((x) => x !== prop.id)
                          : [...display.properties, prop.id],
                      })
                    }
                    className={cn(
                      "h-6 rounded-full border px-2.5 text-xs transition-colors",
                      on
                        ? "border-border bg-accent text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {prop.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="flex justify-end border-t border-border p-2">
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

type PanelTab = "health" | "team" | "lead";

/** Linear's right-hand summary: counts by Health / Teams / Leads over the
 *  current view; clicking a row narrows the page to it. */
function SummaryPanel({
  projects,
  declared,
  spaces,
  members,
  spaceIdsByProject,
  focus,
  onFocus,
}: {
  projects: ProjectTracking[];
  declared: Parameters<typeof effectiveHealth>[1];
  spaces: { id: string; name: string; color: ProjectTeam["color"] }[];
  members: ProjectMember[];
  spaceIdsByProject: Map<string, string[]>;
  focus: Focus | null;
  onFocus: (f: Focus | null) => void;
}) {
  const [tab, setTab] = useState<PanelTab>("health");

  const rows = useMemo(() => {
    if (tab === "health") {
      const counts = new Map<EffectiveHealth, number>();
      for (const p of projects) {
        const h = effectiveHealth(p, declared).health;
        counts.set(h, (counts.get(h) ?? 0) + 1);
      }
      return (["on_track", "at_risk", "off_track", "none"] as EffectiveHealth[])
        .filter((h) => counts.get(h))
        .map((h) => ({
          key: h as string,
          label: HEALTH_LABEL[h],
          icon: <HealthIcon health={h} />,
          count: counts.get(h)!,
        }));
    }
    if (tab === "team") {
      return spaces
        .map((s) => ({
          key: s.id,
          label: s.name,
          icon: <span className={cn("size-2.5 rounded-full", COLOR_DOT[s.color])} />,
          count: projects.filter((p) => (spaceIdsByProject.get(p.id) ?? []).includes(s.id)).length,
        }))
        .filter((r) => r.count > 0);
    }
    const counts = new Map<string, number>();
    for (const p of projects) counts.set(p.lead_user_id ?? "", (counts.get(p.lead_user_id ?? "") ?? 0) + 1);
    return [...counts.entries()].map(([id, count]) => ({
      key: id,
      label: id ? (members.find((m) => m.id === id)?.name ?? "Member") : "No lead",
      icon: null,
      count,
    }));
  }, [tab, projects, declared, spaces, members, spaceIdsByProject]);

  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-3 border-l border-border p-3 md:flex">
      <div className="flex gap-1">
        {(
          [
            ["health", "Health"],
            ["team", "Teams"],
            ["lead", "Leads"],
          ] as [PanelTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "h-7 flex-1 rounded-full text-sm transition-colors",
              tab === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">Nothing to summarise.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => {
            const active = focus?.kind === tab && focus.key === r.key;
            return (
              <li key={r.key || "none"}>
                <button
                  type="button"
                  onClick={() =>
                    onFocus(
                      active
                        ? null
                        : tab === "health"
                          ? { kind: "health", key: r.key as EffectiveHealth }
                          : { kind: tab, key: r.key },
                    )
                  }
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-accent",
                    active && "bg-accent",
                  )}
                >
                  {r.icon}
                  <span className="min-w-0 flex-1 truncate text-left text-foreground">{r.label}</span>
                  <span className="text-muted-foreground tabular-nums">{r.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
