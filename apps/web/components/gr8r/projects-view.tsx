"use client";

import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Calendar,
  CircleCheck,
  Columns3,
  Flag,
  FolderKanban,
  GanttChart,
  LayoutGrid,
  List,
  PanelRight,
  Plus,
  Search,
  SearchX,
  SlidersHorizontal,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { FavMark } from "@/components/gr8r/favorite-star";
import { useFavorites } from "@/lib/favorites/use-favorites";
import {
  Av,
  AvStack,
  G8_COLOR,
  PStatus,
  ProgBar,
  type AvMember,
} from "@/components/gr8r/home-glyphs";
import {
  projectSpacesQueryOptions,
  projectsTrackingQueryOptions,
  spacesQueryOptions,
  type ProjectTracking,
} from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import {
  declaredHealthQueryOptions,
  type DeclaredHealthIndex,
} from "@/lib/query/initiative-queries";
import {
  propertyMilestonesQueryOptions,
  type PropertyMilestone,
} from "@/lib/query/milestone-queries";
import { useOpenProject } from "@/lib/projects/use-open-project";
import type { ProjectStatus } from "@/lib/db/types";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import {
  PROJECT_STATUS_META,
  STATUS_ORDER,
  progressPct,
  shortDate,
  type ProjectMember,
  type ProjectTeam,
} from "@/components/projects/tracking/tracking-shared";
import { ProjectsBoardView } from "@/components/projects/tracking/board-view";
import { ProjectsTimelineView } from "@/components/projects/tracking/timeline-view";
import {
  HEALTH_LABEL,
  HealthIcon,
  LIST_PROPERTIES,
  OptionMenu,
  ProjectRowMenu,
  ageShort,
  effectiveHealth,
  groupProjects,
  nextMilestone,
  useProjectsDisplay,
  type EffectiveHealth,
  type ListProperty,
  type ProjectGroup,
  type ProjectsDisplay,
  type ProjectsGrouping,
  type ProjectsLayout,
  type ProjectsOrdering,
} from "@/components/projects/tracking/project-display";
import {
  EMPTY_PROJECT_FILTERS,
  ProjectsFilterBar,
  hasAnyProjectFacet,
  matchesProjectFilters,
  type ProjectsFilters,
} from "@/components/projects/projects-filters";

/**
 * gr8r-studio's `pageProjects` (src/pages/projects.js) over our projects:
 * the `.ph` head with active / completed counts, a search + status + sort
 * toolbar, and Grid (`.pgrid` / `.pcard`) / List (`.mini` rows) / Table
 * (`.perm-t`) layouts — plus our own Board and Timeline layouts, the facet
 * filters (team / member / target), grouping by status / health / lead,
 * "show completed", the Health / Teams / Leads summary panel and the per-row
 * "…" menu (open / set status / copy link).
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const LAYOUTS: { id: ProjectsLayout; label: string; icon: LucideIcon }[] = [
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "list", label: "List", icon: List },
  { id: "table", label: "Table", icon: Table2 },
  { id: "board", label: "Board", icon: Columns3 },
  { id: "timeline", label: "Timeline", icon: GanttChart },
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

/** Project status → gr8r pill colour. */
const STATUS_COLOR: Record<ProjectStatus, string> = {
  planned: "var(--g8-gray)",
  active: "var(--g8-blue)",
  completed: "var(--g8-green)",
  archived: "var(--g8-gray)",
};
const HEALTH_COLOR: Record<EffectiveHealth, string> = {
  on_track: "var(--g8-green)",
  at_risk: "var(--g8-amber)",
  off_track: "var(--g8-red)",
  none: "var(--g8-gray)",
};

/** gr8r folds "At risk" into the status pill — so do we, for active work. */
function statusPill(p: ProjectTracking, health: EffectiveHealth) {
  if (p.status === "active" && (health === "at_risk" || health === "off_track"))
    return { name: HEALTH_LABEL[health], color: HEALTH_COLOR[health] };
  return { name: PROJECT_STATUS_META[p.status].label, color: STATUS_COLOR[p.status] };
}
function progressTone(p: ProjectTracking, health: EffectiveHealth): string {
  if (p.status === "completed") return "green";
  if (health === "off_track") return "red";
  if (health === "at_risk") return "amber";
  return "";
}

/** The summary panel's lens — clicking a row narrows the page to it. */
type Focus = { kind: "health"; key: EffectiveHealth } | { kind: "team" | "lead"; key: string };

/** A click that started inside a portal (the "…" menu) must not open the row. */
function fromInside(e: MouseEvent<HTMLElement>): boolean {
  return e.currentTarget.contains(e.target as Node);
}

export function ProjectsView({ propertyId }: { propertyId: string }) {
  const searchParams = useSearchParams();
  const spaceParam = searchParams.get("space");
  const qc = useQueryClient();
  const openProject = useOpenProject(propertyId);
  const { display, update, reset } = useProjectsDisplay();

  const { data: projects = [], isPending } = useQuery(projectsTrackingQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: declared } = useQuery(declaredHealthQueryOptions(propertyId));
  const { data: milestones = [] } = useQuery(propertyMilestonesQueryOptions(propertyId));
  const { data: projectSpacePairs = [] } = useQuery(projectSpacesQueryOptions(propertyId));
  const [createOpen, setCreateOpen] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [q, setQ] = useState("");

  // Deep links from the sidebar (`?space=<id>`) seed the Team facet.
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
    // Dropping the linked-in team also strips the URL param, or a reload
    // silently re-applies the filter the user just removed.
    if (spaceParam && !next.spaceIds.includes(spaceParam)) {
      const url = new URL(window.location.href);
      url.searchParams.delete("space");
      window.history.replaceState(null, "", url);
    }
  }

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

  const [now] = useState(() => Date.now());
  const filtering = hasAnyProjectFacet(filters);
  const term = q.trim().toLowerCase();
  // Search + facets + "show completed" — the base set the summary counts over.
  const base = useMemo(
    () =>
      projects.filter(
        (p) =>
          (display.showCompleted || p.status !== "completed") &&
          (!term ||
            (p.name ?? "").toLowerCase().includes(term) ||
            (p.description ?? "").toLowerCase().includes(term)) &&
          (!filtering || matchesProjectFilters(p, filters, spaceIdsByProject, now)),
      ),
    [projects, display.showCompleted, term, filtering, filters, spaceIdsByProject, now],
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
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const toAv = (id: string | null | undefined): AvMember | null => {
    if (!id) return null;
    const m = memberById.get(id);
    return m ? { id: m.id, name: m.name, avatarUrl: m.avatarUrl } : null;
  };

  function onChanged() {
    void qc.invalidateQueries({ queryKey: ["projects-tracking", propertyId] });
    void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
  }
  function clearAll() {
    changeFilters(EMPTY_PROJECT_FILTERS);
    setFocus(null);
    setQ("");
    update({ showCompleted: true });
  }

  const activeCount = projects.filter((p) => p.status !== "completed").length;
  const doneCount = projects.length - activeCount;
  const narrowed = filtering || !!focus || !!term || !display.showCompleted;
  const statusValue = filters.statuses.length === 1 ? filters.statuses[0]! : filters.statuses.length ? "multi" : "all";

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
  const rowCtx: RowCtx = {
    propertyId,
    declared,
    milestonesByProject,
    teamsByProject,
    toAv,
    onOpen: openProject,
    onChanged,
  };

  let body: React.ReactNode;
  if (isPending) {
    body = (
      <div className="panel">
        <div className="empty-state sm">
          <p>Loading projects…</p>
        </div>
      </div>
    );
  } else if (!projects.length) {
    body = (
      <div className="panel">
        <div className="empty-state">
          <div className="glyph">
            <Gi icon={FolderKanban} size={20} />
          </div>
          <h2 className="es-h">No projects yet</h2>
          <p>Create your first project to start organizing your work.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <Gi icon={Plus} size={14} />
            Create project
          </button>
        </div>
      </div>
    );
  } else if (!shown.length) {
    body = (
      <div className="panel">
        <div className="empty-state">
          <div className="glyph">
            <Gi icon={SearchX} size={20} />
          </div>
          <h2 className="es-h">No results found</h2>
          <p>No projects match your search or filters. Try a different term.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll}>
            Clear filters
          </button>
        </div>
      </div>
    );
  } else if (display.layout === "board" || display.layout === "timeline") {
    // Data canvases: a framed, fixed-height pane that scrolls inside itself.
    body = (
      <div
        className="panel"
        style={{ overflow: "hidden", height: "calc(100dvh - 250px)", minHeight: 420 }}
      >
        {display.layout === "board" ? (
          <ProjectsBoardView {...viewProps} />
        ) : (
          <ProjectsTimelineView {...viewProps} />
        )}
      </div>
    );
  } else {
    body = (
      <Grouped groups={groups} grouped={display.grouping !== "none"}>
        {(rows) =>
          display.layout === "grid" ? (
            <div className="pgrid">
              {rows.map((p) => (
                <ProjectCard key={p.id} p={p} ctx={rowCtx} />
              ))}
            </div>
          ) : display.layout === "list" ? (
            <div className="panel" style={{ overflow: "hidden" }}>
              {rows.map((p) => (
                <ProjectListRow key={p.id} p={p} ctx={rowCtx} />
              ))}
            </div>
          ) : (
            <ProjectTable rows={rows} ctx={rowCtx} properties={display.properties} />
          )
        }
      </Grouped>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Projects"
        icon={<FolderKanban />}
        actions={
          <Link
            className="ibtn"
            href={`/p/${propertyId}/archive`}
            title="Archive"
            aria-label="Archive"
          >
            <Gi icon={Archive} size={16} />
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          <div className="ph">
            <div>
              <h1>Projects</h1>
              <p>
                {activeCount} active · {doneCount} completed
                {narrowed && projects.length ? ` · showing ${shown.length} of ${projects.length}` : ""}
              </p>
            </div>
            <div className="acts">
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Gi icon={Plus} size={14} />
                New project
              </button>
            </div>
          </div>

          <div className="row" style={{ marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <div className="inwrap">
              <Gi icon={Search} size={13} />
              <input
                className="input search-sm"
                placeholder="Search projects"
                aria-label="Search projects"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              className="select"
              style={{ height: 26, width: "auto", fontSize: 12 }}
              aria-label="Filter by status"
              value={statusValue}
              onChange={(e) =>
                changeFilters({
                  ...filters,
                  statuses: e.target.value === "all" ? [] : [e.target.value as ProjectStatus],
                })
              }
            >
              <option value="all">All statuses</option>
              {statusValue === "multi" ? (
                <option value="multi" disabled>
                  Several statuses
                </option>
              ) : null}
              {STATUS_ORDER.filter((s) => s !== "archived").map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_META[s].label}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ height: 26, width: "auto", fontSize: 12 }}
              aria-label="Sort"
              value={display.ordering}
              onChange={(e) => update({ ordering: e.target.value as ProjectsOrdering })}
            >
              {ORDERINGS.map((o) => (
                <option key={o.id} value={o.id}>
                  Sort: {o.label}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ height: 26, width: "auto", fontSize: 12 }}
              aria-label="Group by"
              value={display.grouping}
              onChange={(e) => update({ grouping: e.target.value as ProjectsGrouping })}
            >
              {GROUPINGS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id === "none" ? g.label : `Group: ${g.label}`}
                </option>
              ))}
            </select>
            <ProjectsFilterBar
              filters={filters}
              onChange={changeFilters}
              data={{ spaces, members: memberList }}
            />
            {focus ? (
              <button type="button" className="badge" onClick={() => setFocus(null)}>
                {focusLabel(focus, spaces, memberList)}
                <span aria-hidden className="faint">
                  ×
                </span>
              </button>
            ) : null}
            <span className="sp" />
            <DisplayOptions display={display} update={update} reset={reset} />
            <button
              type="button"
              className={`ibtn hide-m${display.panel ? " on" : ""}`}
              aria-pressed={display.panel}
              aria-label={display.panel ? "Hide summary" : "Show summary"}
              title={display.panel ? "Hide summary" : "Show summary"}
              onClick={() => update({ panel: !display.panel })}
            >
              <Gi icon={PanelRight} size={15} />
            </button>
            <div className="seg" role="tablist" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="tab"
                  aria-selected={display.layout === l.id}
                  aria-label={l.label}
                  className={display.layout === l.id ? "on" : ""}
                  onClick={() => update({ layout: l.id })}
                >
                  <Gi icon={l.icon} size={13} />
                  <span className="hide-m">{l.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
            {display.panel && projects.length ? (
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
        </div>
      </div>

      <CreateEntityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        propertyId={propertyId}
        kind="project"
      />
    </div>
  );
}

/* ------------------------------- Grouping -------------------------------- */

function Grouped({
  groups,
  grouped,
  children,
}: {
  groups: ProjectGroup[];
  grouped: boolean;
  children: (rows: ProjectTracking[]) => React.ReactNode;
}) {
  if (!grouped) return <>{children(groups.flatMap((g) => g.rows))}</>;
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} style={{ marginBottom: 22 }}>
          <div className="eyebrow row" style={{ marginBottom: 8, gap: 6 }}>
            {g.icon}
            {g.label} · {g.rows.length}
          </div>
          {children(g.rows)}
        </section>
      ))}
    </>
  );
}

/* --------------------------------- Rows ---------------------------------- */

export type RowCtx = {
  propertyId: string;
  declared: DeclaredHealthIndex | undefined;
  milestonesByProject: Map<string, PropertyMilestone[]>;
  teamsByProject: Map<string, ProjectTeam[]>;
  toAv: (id: string | null | undefined) => AvMember | null;
  onOpen: (projectId: string) => void;
  onChanged: () => void;
};

function PIcon({ p, size = 28, glyph = 15 }: { p: ProjectTracking; size?: number; glyph?: number }) {
  return (
    <span
      className="picon"
      style={
        {
          "--g8-c": G8_COLOR[p.color] ?? G8_COLOR.slate,
          "--g8-sz": `${size}px`,
          fontSize: Math.round(size * 0.5),
        } as CSSVars
      }
    >
      {p.icon ? p.icon : <Gi icon={FolderKanban} size={glyph} />}
    </span>
  );
}

function RowMenu({ p, ctx, className }: { p: ProjectTracking; ctx: RowCtx; className: string }) {
  return (
    <ProjectRowMenu
      project={p}
      propertyId={ctx.propertyId}
      href={`/p/${ctx.propertyId}/projects/${p.id}`}
      onChanged={ctx.onChanged}
      onOpen={() => ctx.onOpen(p.id)}
      bare
      className={className}
    />
  );
}

function rowProps(p: ProjectTracking, ctx: RowCtx) {
  return {
    role: "link" as const,
    tabIndex: 0,
    "aria-label": p.name,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (fromInside(e)) ctx.onOpen(p.id);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" && e.target === e.currentTarget) ctx.onOpen(p.id);
    },
  };
}

function contributors(p: ProjectTracking, ctx: RowCtx): AvMember[] {
  return p.contributorIds.map(ctx.toAv).filter((m): m is AvMember => m !== null);
}

/** gr8r prints a small amber star after a favorite project's name. */
function CardFavMark({ propertyId, projectId }: { propertyId: string; projectId: string }) {
  const { isFavorite } = useFavorites(propertyId);
  return isFavorite("project", projectId) ? <FavMark /> : null;
}

/**
 * A `RowCtx` for rendering `ProjectCard`s outside the Projects page (the
 * Favorites page). Same data the page reads, from the shared caches.
 */
export function useProjectCardCtx(propertyId: string): RowCtx {
  const qc = useQueryClient();
  const openProject = useOpenProject(propertyId);
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: declared } = useQuery(declaredHealthQueryOptions(propertyId));
  const { data: milestones = [] } = useQuery(propertyMilestonesQueryOptions(propertyId));
  const { data: pairs = [] } = useQuery(projectSpacesQueryOptions(propertyId));
  return useMemo(() => {
    const spaceById = new Map(spaces.map((s) => [s.id, s]));
    const teamsByProject = new Map<string, ProjectTeam[]>();
    for (const pair of pairs) {
      const space = spaceById.get(pair.space_id);
      if (!space) continue;
      const list = teamsByProject.get(pair.project_id) ?? [];
      list.push({ id: space.id, name: space.name, color: space.color });
      teamsByProject.set(pair.project_id, list);
    }
    const milestonesByProject = new Map<string, PropertyMilestone[]>();
    for (const m of milestones) {
      if (!m.project_id) continue;
      const list = milestonesByProject.get(m.project_id) ?? [];
      list.push(m);
      milestonesByProject.set(m.project_id, list);
    }
    const memberById = new Map(members.map((m) => [m.id, m]));
    return {
      propertyId,
      declared,
      milestonesByProject,
      teamsByProject,
      toAv: (id) => {
        const m = id ? memberById.get(id) : undefined;
        return m ? { id: m.id, name: m.name, avatarUrl: m.avatarUrl } : null;
      },
      onOpen: openProject,
      onChanged: () => {
        void qc.invalidateQueries({ queryKey: ["projects-tracking", propertyId] });
        void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
      },
    };
  }, [propertyId, spaces, members, declared, milestones, pairs, openProject, qc]);
}

/** gr8r `projectCard` (also the Favorites page's project grid). */
export function ProjectCard({ p, ctx }: { p: ProjectTracking; ctx: RowCtx }) {
  const { health } = effectiveHealth(p, ctx.declared);
  const pr = progressPct(p.done, p.total);
  const pill = statusPill(p, health);
  const ms = nextMilestone(ctx.milestonesByProject.get(p.id));
  return (
    <div className="pcard" {...rowProps(p, ctx)}>
      <div className="row">
        <PIcon p={p} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <b className="trunc" style={{ fontWeight: 600, fontSize: 14 }}>
              {p.name}
            </b>
            <CardFavMark propertyId={ctx.propertyId} projectId={p.id} />
          </div>
        </div>
        <PStatus name={pill.name} color={pill.color} />
      </div>
      <div className="desc">{p.description || <span className="faint">No description</span>}</div>
      <div className="row" style={{ gap: 10 }}>
        <ProgBar value={pr} tone={progressTone(p, health)} />
        <span className="num" style={{ fontSize: 12, fontWeight: 500 }}>
          {pr}%
        </span>
      </div>
      <div className="foot">
        <span className="row" style={{ gap: 4 }} title="Tasks done">
          <Gi icon={CircleCheck} size={12} />
          {p.done}/{p.total}
        </span>
        <span className="row" style={{ gap: 4 }} title="Target date">
          <Gi icon={Calendar} size={12} />
          {shortDate(p.target_date)}
        </span>
        {ms ? (
          <span className="row hide-m trunc" style={{ gap: 4, minWidth: 0 }} title="Next milestone">
            <Gi icon={Flag} size={12} />
            <span className="trunc">{ms.name}</span>
          </span>
        ) : null}
        <span className="sp" />
        <AvStack members={contributors(p, ctx)} max={3} />
      </div>
      <RowMenu p={p} ctx={ctx} className="ibtn ibtn-sm more" />
    </div>
  );
}

/** gr8r's List layout row (`.mini`). */
function ProjectListRow({ p, ctx }: { p: ProjectTracking; ctx: RowCtx }) {
  const { health } = effectiveHealth(p, ctx.declared);
  const pr = progressPct(p.done, p.total);
  const pill = statusPill(p, health);
  return (
    <div className="mini" style={{ minHeight: 52, gap: 12 }} {...rowProps(p, ctx)}>
      <PIcon p={p} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500 }} className="trunc">
          {p.name}
        </div>
        <div className="trunc faint" style={{ fontSize: 12 }}>
          {p.description}
        </div>
      </div>
      <span className="hide-m">
        <PStatus name={pill.name} color={pill.color} />
      </span>
      <span className="row hide-m" style={{ width: 140 }}>
        <ProgBar value={pr} tone={progressTone(p, health)} />
        <span className="num faint" style={{ fontSize: 11.5 }}>
          {pr}%
        </span>
      </span>
      <span className="num muted hide-m" style={{ width: 70, fontSize: 12 }}>
        {shortDate(p.target_date)}
      </span>
      <AvStack members={contributors(p, ctx)} max={3} />
      <RowMenu p={p} ctx={ctx} className="ibtn ibtn-sm" />
    </div>
  );
}

/** gr8r's Table layout (`.perm-t`); Display options toggle the optional columns. */
function ProjectTable({
  rows,
  ctx,
  properties,
}: {
  rows: ProjectTracking[];
  ctx: RowCtx;
  properties: ListProperty[];
}) {
  const on = (k: ListProperty) => properties.includes(k);
  const left: CSSProperties = { textAlign: "left" };
  return (
    <div className="panel" style={{ overflowX: "auto" }}>
      <table className="perm-t" style={{ minWidth: 860 }}>
        <thead>
          <tr>
            <th style={{ paddingLeft: 14, textAlign: "left" }}>Project</th>
            {on("status") ? <th style={left}>Status</th> : null}
            {on("health") ? <th style={left}>Health</th> : null}
            {on("lead") ? <th style={left}>Lead</th> : null}
            <th style={left}>Team</th>
            <th style={{ ...left, width: "14%" }}>Progress</th>
            {on("issues") ? <th>Tasks</th> : null}
            {on("milestone") ? <th style={left}>Next milestone</th> : null}
            <th style={left}>Start</th>
            {on("target") ? <th style={left}>Target</th> : null}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const { health, at } = effectiveHealth(p, ctx.declared);
            const pr = progressPct(p.done, p.total);
            const age = ageShort(at);
            const lead = ctx.toAv(p.lead_user_id);
            const teams = ctx.teamsByProject.get(p.id) ?? [];
            const ms = nextMilestone(ctx.milestonesByProject.get(p.id));
            return (
              <tr key={p.id} style={{ cursor: "pointer" }} {...rowProps(p, ctx)}>
                <td style={{ paddingLeft: 14 }}>
                  <span className="row">
                    <PIcon p={p} size={22} glyph={13} />
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                  </span>
                </td>
                {on("status") ? (
                  <td style={left}>
                    <PStatus name={PROJECT_STATUS_META[p.status].label} color={STATUS_COLOR[p.status]} />
                  </td>
                ) : null}
                {on("health") ? (
                  <td style={left}>
                    <span className="row" style={{ gap: 6 }}>
                      <HealthIcon health={health} />
                      <span className="muted">
                        {HEALTH_LABEL[health]}
                        {age ? ` · ${age}` : ""}
                      </span>
                    </span>
                  </td>
                ) : null}
                {on("lead") ? (
                  <td style={left}>
                    <span className="row">
                      <Av member={lead} />
                      <span className={lead ? "" : "faint"}>{lead?.name ?? "No lead"}</span>
                    </span>
                  </td>
                ) : null}
                <td style={left} className="muted">
                  {teams.length ? teams.map((t) => t.name).join(", ") : "—"}
                </td>
                <td>
                  <span className="row">
                    <ProgBar value={pr} tone={progressTone(p, health)} />
                    <span className="num faint" style={{ fontSize: 11.5 }}>
                      {pr}%
                    </span>
                  </span>
                </td>
                {on("issues") ? (
                  <td className="num">
                    {p.done}/{p.total}
                  </td>
                ) : null}
                {on("milestone") ? (
                  <td style={left} className="muted">
                    {ms ? (
                      <span className="row" style={{ gap: 4 }}>
                        <Gi icon={Flag} size={12} />
                        {ms.name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
                <td style={left} className="num muted">
                  {shortDate(p.start_date)}
                </td>
                {on("target") ? (
                  <td style={left} className="num muted">
                    {shortDate(p.target_date)}
                  </td>
                ) : null}
                <td>
                  <RowMenu p={p} ctx={ctx} className="ibtn ibtn-sm" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------- Display options ----------------------------- */

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
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Display options"
            title="Display options"
          />
        }
      >
        <Gi icon={SlidersHorizontal} size={14} />
        <span className="hide-m">Display</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex flex-col gap-1 p-3 text-sm">
          <OptRow label="Grouping">
            <OptionMenu
              label="Grouping"
              value={display.grouping}
              options={GROUPINGS}
              onChange={(grouping) => update({ grouping })}
            />
          </OptRow>
          <OptRow label="Ordering">
            <OptionMenu
              label="Ordering"
              value={display.ordering}
              options={ORDERINGS}
              onChange={(ordering) => update({ ordering })}
            />
          </OptRow>
          <OptRow label="Show completed projects">
            <Switch
              checked={display.showCompleted}
              onCheckedChange={(v) => update({ showCompleted: v })}
              aria-label="Show completed projects"
            />
          </OptRow>
        </div>
        {display.layout === "table" ? (
          <div className="border-t border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">Table columns</p>
            <div className="flex flex-wrap gap-1.5">
              {LIST_PROPERTIES.map((prop) => {
                const active = display.properties.includes(prop.id);
                return (
                  <button
                    key={prop.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      update({
                        properties: active
                          ? display.properties.filter((x) => x !== prop.id)
                          : [...display.properties, prop.id],
                      })
                    }
                    className={
                      active
                        ? "h-6 rounded-full border border-border bg-accent px-2.5 text-xs text-foreground"
                        : "h-6 rounded-full border border-transparent px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    }
                  >
                    {prop.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="flex justify-end border-t border-border p-2">
          <button
            type="button"
            className="h-7 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={reset}
          >
            Reset
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OptRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
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

/* ---------------------------- Summary panel ------------------------------ */

type PanelTab = "health" | "team" | "lead";

/** Health / Teams / Leads counts over the current view; a row narrows to it. */
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
  declared: DeclaredHealthIndex | undefined;
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
          icon: (
            <span
              className="pdot"
              style={{ "--g8-c": G8_COLOR[s.color] ?? G8_COLOR.slate } as CSSVars}
            />
          ),
          count: projects.filter((p) => (spaceIdsByProject.get(p.id) ?? []).includes(s.id)).length,
        }))
        .filter((r) => r.count > 0);
    }
    const counts = new Map<string, number>();
    for (const p of projects) counts.set(p.lead_user_id ?? "", (counts.get(p.lead_user_id ?? "") ?? 0) + 1);
    return [...counts.entries()].map(([id, count]) => {
      const m = id ? members.find((x) => x.id === id) : undefined;
      return {
        key: id,
        label: id ? (m?.name ?? "Member") : "No lead",
        icon: <Av member={m ? { id: m.id, name: m.name, avatarUrl: m.avatarUrl } : null} />,
        count,
      };
    });
  }, [tab, projects, declared, spaces, members, spaceIdsByProject]);

  return (
    <aside className="panel hide-m" style={{ width: 272, flexShrink: 0, overflow: "hidden" }}>
      <div style={{ padding: 10, borderBottom: "1px solid var(--g8-divider)" }}>
        <div className="seg" role="tablist" aria-label="Summary" style={{ width: "100%" }}>
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
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "on" : ""}
              style={{ flex: 1 }}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state sm">
          <p>Nothing to summarise.</p>
        </div>
      ) : (
        rows.map((r) => {
          const active = focus?.kind === tab && focus.key === r.key;
          return (
            <div
              key={r.key || "none"}
              className={`mini${active ? " on" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              style={active ? { background: "var(--g8-surface-2)" } : undefined}
              onClick={() =>
                onFocus(
                  active
                    ? null
                    : tab === "health"
                      ? { kind: "health", key: r.key as EffectiveHealth }
                      : { kind: tab, key: r.key },
                )
              }
            >
              {r.icon}
              <span className="tt">{r.label}</span>
              <span className="num faint">{r.count}</span>
            </div>
          );
        })
      )}
    </aside>
  );
}
