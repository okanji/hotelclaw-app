"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Archive,
  CalendarDays,
  ChartGantt,
  Ellipsis,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Link2,
  List,
  SquareKanban,
} from "lucide-react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EntityColor, ProjectStatus, Role, TaskStatus, UpdateHealth } from "@/lib/db/types";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import {
  documentsQueryOptions,
  propertyMembersQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import {
  archiveProject,
  setProjectSpaces,
  setTaskProject,
  updateProject,
} from "./actions";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import {
  ActivityLogFeed,
  useActivityLogRealtime,
  useActivityLookup,
  useViewerId,
} from "@/components/activity/activity-log";
import { useUrlTab } from "./workspace-shell";
import { EntityLabelsRow } from "@/components/labels/entity-labels-row";
import { ScopeStatStrip } from "@/components/insights/scope-stat-strip";
import { CatchUpBanner } from "@/components/insights/catch-up-banner";
import { WorkspaceDescription } from "./workspace-description";
import { projectHealth, type ProjectHealth } from "./tracking/tracking-shared";
import { MilestonesPanel } from "./milestones-panel";
import { ProjectProgressBlock } from "./progress-block";
import { UpdatesSection } from "./project-updates";
import { ProjectInitiativesPicker } from "./project-initiatives-picker";
import { declaredHealthQueryOptions } from "@/lib/query/initiative-queries";
import { milestoneProgress } from "@/lib/initiatives/planning";
import { TimelineView } from "@/components/tasks/timeline-view";
import type { Task } from "@/components/tasks/kanban";
import { useAssigneesMap } from "@/lib/tasks/use-assignees";
import { isDone } from "@/lib/tasks/statuses";
import { taskAssigneeIds } from "@/lib/tasks/assignees";
import { AutomationsButton } from "@/components/workflows/automations-button";
import { Gi } from "@/components/gr8r/icon";
import { AvStack, G8_COLOR } from "@/components/gr8r/home-glyphs";
import {
  fmtDay,
  LeadPicker,
  ProjectIcon,
  ProjectPageShell,
  ProjectStatusMenu,
  TeamsPicker,
  type CSSVars,
  type ProjectTabDef,
} from "@/components/gr8r/project-page";
import { FavoriteStar } from "@/components/gr8r/favorite-star";
import { canManage } from "@/lib/auth/roles";
import {
  KV_ICONS,
  KvRow,
  MembersValue,
  ProjectOverview,
} from "@/components/gr8r/project-overview";
import { ProjectTaskViews } from "@/components/gr8r/project-tasks";
import { ProjectCalendar } from "@/components/gr8r/project-calendar";
import { ProjectFiles } from "@/components/gr8r/project-files";

/**
 * The single project page, on gr8r-studio's `pageProject`
 * (src/pages/project.js): `.proj-h` header (icon, editable name, status
 * pill, members, actions) + view tabs Overview · Board · List · Timeline ·
 * Calendar · Files · Activity. Board / List are the real tasks board
 * components scoped to the project; Timeline is the Gantt with the
 * project's milestone lane; Files = linked docs + task attachments.
 * `?tab=` deep-links (the sidebar's Board / List / Timeline / Files rows);
 * the old ids `tasks` / `docs` / `members` resolve onto their new homes.
 */

const TABS: ProjectTabDef[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "board", label: "Board", icon: SquareKanban },
  { id: "list", label: "List", icon: List },
  { id: "timeline", label: "Timeline", icon: ChartGantt },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "docs", label: "Docs", icon: FileText },
  { id: "activity", label: "Activity", icon: Activity },
];
const TAB_ALIASES: Record<string, string> = {
  tasks: "board",
  files: "docs",
  members: "overview",
  contributors: "overview",
};

/** The last project tab you viewed (per browser), so the next project you
 *  open lands on it. Board until you've picked something else. */
const LAST_TAB_KEY = "hotelclaw:project-tab";
function readLastProjectTab(): string {
  try {
    return window.localStorage.getItem(LAST_TAB_KEY) || "board";
  } catch {
    return "board";
  }
}
function writeLastProjectTab(tab: string) {
  try {
    window.localStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    // Private mode / blocked storage: every project opens on Board.
  }
}
function subscribeLastProjectTab(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function useLastProjectTab(): string {
  return useSyncExternalStore(subscribeLastProjectTab, readLastProjectTab, () => "board");
}

/** Computed pace read → gr8r colour. */
const PACE: Record<ProjectHealth, { name: string; c: string }> = {
  none: { name: "No date", c: "var(--g8-gray)" },
  on_track: { name: "On track", c: "var(--g8-green)" },
  at_risk: { name: "At risk", c: "var(--g8-amber)" },
  overdue: { name: "Overdue", c: "var(--g8-red)" },
  done: { name: "Done", c: "var(--g8-violet)" },
};
/** A person's declared call (latest status update). */
const DECLARED: Record<UpdateHealth, { name: string; c: string }> = {
  on_track: { name: "On track", c: "var(--g8-green)" },
  at_risk: { name: "At risk", c: "var(--g8-amber)" },
  off_track: { name: "Off track", c: "var(--g8-red)" },
};

type DetailTask = {
  id: string;
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  /** Effort points (0111); null = unestimated, counted as 1 in scope. */
  estimate: number | null;
  milestone_id: string | null;
};

type ProjectDetailData = {
  project: {
    id: string;
    name: string;
    description: string | null;
    color: EntityColor;
    icon: string | null;
    status: ProjectStatus;
    start_date: string | null;
    target_date: string | null;
    created_at: string | null;
    lead_user_id: string | null;
  } | null;
  spaceIds: string[];
  tasks: DetailTask[];
  docs: { id: string; title: string; updated_at: string | null }[];
};

function projectDetailQuery(projectId: string) {
  return {
    queryKey: ["project-detail", projectId] as const,
    queryFn: async (): Promise<ProjectDetailData> => {
      const supabase = createBrowserClient();
      const [proj, links, tasks, docs] = await Promise.all([
        supabase
          .from("projects")
          .select(
            "id, name, description, color, icon, status, start_date, target_date, created_at, lead_user_id",
          )
          .eq("id", projectId)
          .maybeSingle(),
        supabase.from("project_spaces").select("space_id").eq("project_id", projectId),
        supabase
          .from("tasks")
          .select("id, title, status, assignee_id, estimate, milestone_id")
          .eq("project_id", projectId)
          .order("position", { ascending: true }),
        supabase
          .from("documents")
          .select("id, title, updated_at")
          .eq("project_id", projectId)
          .is("archived_at", null)
          .order("updated_at", { ascending: false }),
      ]);
      return {
        project: (proj.data as ProjectDetailData["project"]) ?? null,
        spaceIds: (links.data ?? []).map((l) => l.space_id),
        tasks: (tasks.data ?? []) as DetailTask[],
        docs: (docs.data ?? []) as ProjectDetailData["docs"],
      };
    },
  };
}

const EMPTY_TASKS: Task[] = [];

export function ProjectDetail({
  propertyId,
  projectId,
}: {
  propertyId: string;
  projectId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isPending } = useQuery(projectDetailQuery(projectId));
  const meId = useViewerId();
  const activityLookup = useActivityLookup(propertyId, meId);
  useActivityLogRealtime(propertyId);
  const { data: activity = [] } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "project", id: projectId }, 60),
  );
  const { data: allSpaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: allTasks = EMPTY_TASKS } = useQuery(tasksQueryOptions(propertyId));
  const { data: allDocs = [] } = useQuery(documentsQueryOptions(propertyId));
  const { data: people = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  // The latest written update's call — shown beside the computed pace read.
  const { data: declaredIndex } = useQuery(declaredHealthQueryOptions(propertyId));
  const declared = declaredIndex?.projects[projectId]?.health ?? null;

  // No `?tab=` → the tab you were last on in ANY project (Board the first
  // time), so hopping between projects keeps your view. Fallback "" keeps
  // every pick in the URL — "board" must not be stripped, or a remembered
  // tab would win over it.
  const [urlTab, setTab] = useUrlTab("");
  const lastTab = useLastProjectTab();
  const rawTab = urlTab || lastTab;
  const tab = TAB_ALIASES[rawTab] ?? (TABS.some((t) => t.id === rawTab) ? rawTab : "board");
  useEffect(() => {
    // The projects surface stays mounted after you leave it — only the
    // project you're actually ON may touch the URL or the remembered tab,
    // or it rewrites every other page's URL (a replaceState ↔ RSC loop).
    if (!window.location.pathname.endsWith(`/projects/${projectId}`)) return;
    writeLastProjectTab(tab);
    // Put the resolved tab in the URL, so the sidebar's Board / List /
    // Timeline / Files rows highlight it and the link is shareable.
    if (urlTab !== tab) setTab(tab);
  }, [tab, urlTab, setTab, projectId]);

  const project = data?.project;
  const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks]);
  const docs = useMemo(() => data?.docs ?? [], [data?.docs]);

  const [name, setName] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (project) setName(project.name);
  }, [project]);

  // Full task rows for this project — board, list, Gantt and calendar need
  // dates, parents, lists and assignees the lightweight select doesn't carry.
  const projectTasks = useMemo(
    () => allTasks.filter((t) => t.project_id === projectId),
    [allTasks, projectId],
  );
  const timelineAssignees = useAssigneesMap(
    useMemo(() => projectTasks.flatMap((t) => taskAssigneeIds(t)), [projectTasks]),
  );
  const taskCandidates = useMemo(() => {
    const assigned = new Set(tasks.map((t) => t.id));
    return allTasks
      .filter((t) => !assigned.has(t.id) && !t.parent_id)
      .map((t) => ({ id: t.id, title: t.title }));
  }, [allTasks, tasks]);
  const docCandidates = useMemo(() => {
    const assigned = new Set(docs.map((d) => d.id));
    return allDocs
      .filter((d) => !assigned.has(d.id))
      .map((d) => ({ id: d.id, title: d.title }));
  }, [allDocs, docs]);

  const linkedSpaces = useMemo(
    () => allSpaces.filter((s) => data?.spaceIds.includes(s.id)),
    [allSpaces, data?.spaceIds],
  );
  const memberById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const contributors = useMemo(() => {
    const ids = new Set<string>();
    for (const t of projectTasks) for (const id of taskAssigneeIds(t)) ids.add(id);
    for (const t of tasks) if (t.assignee_id) ids.add(t.assignee_id);
    return people.filter((p) => ids.has(p.id));
  }, [projectTasks, tasks, people]);
  const leadId = project?.lead_user_id ?? null;
  const headMembers = useMemo(() => {
    const lead = leadId ? memberById.get(leadId) : undefined;
    return lead ? [lead, ...contributors.filter((p) => p.id !== lead.id)] : contributors;
  }, [leadId, memberById, contributors]);
  const milestonePct = useMemo(() => milestoneProgress(tasks), [tasks]);
  const doneCount = useMemo(() => tasks.filter((t) => isDone(t)).length, [tasks]);
  const [now] = useState(() => Date.now());
  const overdue = useMemo(() => {
    return projectTasks.filter(
      (t) => !t.parent_id && !isDone(t) && t.due_at && new Date(t.due_at).getTime() < now,
    ).length;
  }, [projectTasks, now]);
  const taskTitleById = useMemo(
    () => new Map(projectTasks.map((t) => [t.id, t.title])),
    [projectTasks],
  );

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["project-detail", projectId] });
  }
  async function commitName() {
    const next = name.trim();
    if (!project || !next || next === project.name) {
      if (project) setName(project.name);
      return;
    }
    const res = await updateProject(projectId, { name: next });
    if ("error" in res) toast.error(res.error);
    else {
      refresh();
      void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
    }
  }
  async function setStatus(status: ProjectStatus) {
    const res = await updateProject(projectId, { status });
    if ("error" in res) toast.error(res.error);
    else {
      refresh();
      void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
    }
  }
  async function setLead(leadId: string | null) {
    const res = await updateProject(projectId, { lead_user_id: leadId });
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function commitDescription(description: string | null) {
    const res = await updateProject(projectId, { description });
    if ("error" in res) return { error: res.error };
    refresh();
    return {};
  }
  async function toggleSpace(spaceId: string) {
    const current = data?.spaceIds ?? [];
    const next = current.includes(spaceId)
      ? current.filter((x) => x !== spaceId)
      : [...current, spaceId];
    const res = await setProjectSpaces(projectId, next);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  const link = (fn: (id: string, pid: string | null) => Promise<unknown>, to: string | null) =>
    async (id: string) => {
      const res = (await fn(id, to)) as { error?: string };
      if (res?.error) toast.error(res.error);
      else {
        refresh();
        void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
      }
    };
  async function handleArchive() {
    if (!window.confirm("Archive this project?")) return;
    const res = await archiveProject(projectId);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
    router.push(`/p/${propertyId}/projects`);
  }
  function copyLink() {
    const url = `${window.location.origin}/p/${propertyId}/projects/${projectId}`;
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy the link"),
    );
  }

  if (isPending)
    return (
      <div className="flex h-full items-center justify-center">
        <span className="faint">Loading project…</span>
      </div>
    );
  if (!project)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <span className="muted">Project not found.</span>
        <Link href={`/p/${propertyId}/projects`} className="btn btn-secondary btn-sm">
          Back to projects
        </Link>
      </div>
    );

  const color = G8_COLOR[project.color] ?? "var(--g8-accent)";
  const pace = projectHealth({
    status: project.status,
    target_date: project.target_date,
    done: doneCount,
    total: tasks.length,
  });
  const healthPills = (
    <span className="row" style={{ gap: 6 }}>
      {declared ? (
        <span
          className="pstatus"
          style={{ "--g8-c": DECLARED[declared].c } as CSSVars}
          title="Declared in the latest project update"
        >
          <i />
          {DECLARED[declared].name}
        </span>
      ) : null}
      <span
        className="pstatus"
        style={{ "--g8-c": PACE[pace].c } as CSSVars}
        title="Computed from pace against the target date"
      >
        <i />
        {PACE[pace].name}
        {declared ? <span className="faint">(pace)</span> : null}
      </span>
    </span>
  );

  const details = (
    <>
      <dl className="kv">
        <KvRow icon={KV_ICONS.status} label="Status">
          <ProjectStatusMenu status={project.status} onSelect={setStatus} bordered={false} />
        </KvRow>
        <KvRow icon={KV_ICONS.health} label="Health">
          {healthPills}
        </KvRow>
        <KvRow icon={KV_ICONS.lead} label="Lead">
          <LeadPicker people={people} leadId={project.lead_user_id} onSelect={setLead} />
        </KvRow>
        <KvRow icon={KV_ICONS.team} label="Teams">
          <TeamsPicker
            allSpaces={allSpaces}
            linkedSpaces={linkedSpaces}
            onToggle={toggleSpace}
            hrefOf={(id) => `/p/${propertyId}/spaces/${id}`}
          />
        </KvRow>
        <KvRow icon={KV_ICONS.start} label="Start">
          <span className={project.start_date ? "pillbtn num" : "pillbtn empty"}>
            {fmtDay(project.start_date) ?? "No start date"}
          </span>
        </KvRow>
        <KvRow icon={KV_ICONS.due} label="Target">
          <span className={project.target_date ? "pillbtn num" : "pillbtn empty"}>
            {fmtDay(project.target_date) ?? "No target date"}
          </span>
        </KvRow>
        <KvRow icon={KV_ICONS.members} label="Members">
          <MembersValue people={contributors} propertyId={propertyId} />
        </KvRow>
        <KvRow icon={KV_ICONS.initiatives} label="Initiatives">
          <ProjectInitiativesPicker propertyId={propertyId} projectId={projectId} />
        </KvRow>
        <KvRow icon={KV_ICONS.created} label="Created">
          <span className="pillbtn num">{fmtDay(project.created_at) ?? "—"}</span>
        </KvRow>
      </dl>
      <div style={{ marginTop: 6 }}>
        <EntityLabelsRow propertyId={propertyId} entityKind="project" entityId={projectId} />
      </div>
    </>
  );

  let body: React.ReactNode;
  switch (tab) {
    case "board":
    case "list":
      body = (
        <ProjectTaskViews
          propertyId={propertyId}
          projectId={projectId}
          mode={tab}
          tasks={projectTasks}
          candidates={taskCandidates}
          onAdd={link(setTaskProject, projectId)}
        />
      );
      break;
    case "timeline":
      body = (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <TimelineView
            propertyId={propertyId}
            tasks={projectTasks}
            assignees={timelineAssignees}
            hideDone={false}
            milestoneScope={{ kind: "project", id: projectId }}
            onChanged={() => {
              refresh();
              void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
            }}
          />
        </div>
      );
      break;
    case "calendar":
      body = (
        <ProjectCalendar
          propertyId={propertyId}
          projectId={projectId}
          tasks={projectTasks}
          color={color}
          people={memberById}
        />
      );
      break;
    case "docs":
      body = (
        <ProjectFiles
          propertyId={propertyId}
          projectId={projectId}
          viewerId={meId}
          canManage={canManage(people.find((p) => p.id === meId)?.role as Role | undefined)}
          docs={docs}
          docCandidates={docCandidates}
          onDocsChanged={refresh}
          taskIds={projectTasks.map((t) => t.id)}
          taskTitle={(id) => taskTitleById.get(id) ?? null}
          people={memberById}
        />
      );
      break;
    case "activity":
      body = (
        <div className="page" style={{ maxWidth: 780, paddingTop: 18, width: "100%" }}>
          <ActivityLogFeed
            propertyId={propertyId}
            scope={{ kind: "project", id: projectId }}
            meId={meId}
            showProject={false}
          />
        </div>
      );
      break;
    default:
      body = (
        <ProjectOverview
          propertyId={propertyId}
          top={
            <>
              <CatchUpBanner propertyId={propertyId} subjectKind="project" subjectId={projectId} />
              <ScopeStatStrip propertyId={propertyId} scope={{ kind: "project", id: projectId }} />
            </>
          }
          about={<WorkspaceDescription value={project.description} onSave={commitDescription} />}
          updates={
            <UpdatesSection
              propertyId={propertyId}
              target={{ kind: "project", id: projectId }}
              variant="panel"
            />
          }
          progress={
            <ProjectProgressBlock
              tasks={tasks}
              people={contributors}
              targetDate={project.target_date}
              overdue={overdue}
              health={healthPills}
              onBucket={() => setTab("list")}
            />
          }
          tasks={projectTasks}
          projectColor={color}
          memberById={memberById}
          details={details}
          milestones={<MilestonesPanel projectId={projectId} progress={milestonePct} color={color} />}
          activity={activity}
          activityLookup={activityLookup}
          onSeeList={() => setTab("list")}
          onSeeActivity={() => setTab("activity")}
        />
      );
  }

  const tabs = TABS.map((t) =>
    t.id === "board" || t.id === "list"
      ? { ...t, count: t.id === "board" ? projectTasks.filter((x) => !x.parent_id).length : undefined }
      : t.id === "files"
        ? { ...t, count: docs.length || undefined }
        : t,
  );

  return (
    <ProjectPageShell
      crumbs={[
        { label: "Projects", href: `/p/${propertyId}/projects`, icon: <FolderKanban /> },
        { label: project.name || "Untitled project" },
      ]}
      icon={<ProjectIcon icon={project.icon} color={project.color} lg />}
      star={
        <FavoriteStar propertyId={propertyId} kind="project" id={projectId} label={project.name} />
      }
      title={
        <h1 style={{ minWidth: 0, flex: "0 1 auto" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setName(project.name);
                e.currentTarget.blur();
              }
            }}
            aria-label="Project name"
            placeholder="Untitled project"
            size={Math.max(8, Math.min(48, name.length + 1))}
            className="proj-name-in"
          />
        </h1>
      }
      status={<ProjectStatusMenu status={project.status} onSelect={setStatus} />}
      members={
        headMembers.length ? (
          <button
            type="button"
            className="row"
            style={{ gap: 0 }}
            aria-label="Members"
            title={headMembers.map((p) => p.name).join(", ")}
            onClick={() => setTab("overview")}
          >
            <AvStack members={headMembers} max={5} />
          </button>
        ) : null
      }
      headActions={
        <>
          <AutomationsButton propertyId={propertyId} feature="tasks" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<button type="button" className="ibtn ibtn-sm" aria-label="More" title="More" />}
            >
              <Gi icon={Ellipsis} size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem onClick={copyLink}>
                <Link2 className="size-3.5" />
                <span className="flex-1">Copy link</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleArchive}>
                <Archive className="size-3.5" />
                <span className="flex-1">Archive project</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      tabs={tabs}
      active={tab}
      onTab={setTab}
    >
      {body}
    </ProjectPageShell>
  );
}
