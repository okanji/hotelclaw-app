"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  Check,
  ChevronRight,
  Layers,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { EntityColor, ProjectStatus, TaskStatus } from "@/lib/db/types";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import {
  documentsQueryOptions,
  propertyMembersQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import {
  archiveProject,
  setDocumentProject,
  setProjectSpaces,
  setTaskProject,
  updateProject,
} from "./actions";
import { activityQuery } from "@/lib/query/activity-queries";
import {
  MetadataItem,
  MetadataRow,
  PropertyRow,
  RailDate,
  RailGroup,
  RailProgress,
  railValueClass,
  WorkspaceShell,
  ws,
  type WorkspaceTab,
} from "./workspace-shell";
import { EntityLabelsRow } from "@/components/labels/entity-labels-row";
import { ScopeStatStrip } from "@/components/insights/scope-stat-strip";
import { CatchUpBanner } from "@/components/insights/catch-up-banner";
import { WorkspaceDescription } from "./workspace-description";
import {
  ActivityFeed,
  DocsPanel,
  ProgressOverview,
  TasksPanel,
  type ScopedTask,
} from "./workspace-panels";
import { HEALTH_META, projectHealth } from "./tracking/tracking-shared";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  planned: "Planned",
  completed: "Completed",
  archived: "Archived",
};
const STATUS_DOT: Record<ProjectStatus, string> = {
  active: "bg-emerald-500",
  planned: "bg-blue-500",
  completed: "bg-violet-500",
  archived: "bg-muted-foreground/50",
};
const DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

type DetailTask = ScopedTask & { assignee_id: string | null };

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
  } | null;
  spaceIds: string[];
  tasks: DetailTask[];
  docs: { id: string; title: string }[];
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
            "id, name, description, color, icon, status, start_date, target_date, created_at",
          )
          .eq("id", projectId)
          .maybeSingle(),
        supabase.from("project_spaces").select("space_id").eq("project_id", projectId),
        supabase
          .from("tasks")
          .select("id, title, status, assignee_id")
          .eq("project_id", projectId)
          .order("position", { ascending: true }),
        supabase
          .from("documents")
          .select("id, title")
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
  const { data: activity = [], isPending: activityPending } = useQuery(
    activityQuery(propertyId, { project: projectId }),
  );
  const { data: allSpaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: allTasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { data: allDocs = [] } = useQuery(documentsQueryOptions(propertyId));
  const { data: people = [] } = useQuery(propertyMembersQueryOptions(propertyId));

  const project = data?.project;
  const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks]);
  const docs = useMemo(() => data?.docs ?? [], [data?.docs]);

  const [name, setName] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (project) setName(project.name);
  }, [project]);

  const taskCandidates = useMemo(() => {
    const assigned = new Set(tasks.map((t) => t.id));
    return allTasks
      .filter((t) => !assigned.has(t.id))
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
  const contributors = useMemo(() => {
    const ids = new Set(
      tasks.map((t) => t.assignee_id).filter((x): x is string => !!x),
    );
    return people.filter((p) => ids.has(p.id));
  }, [tasks, people]);
  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = {
      todo: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
    };
    for (const t of tasks) c[t.status] += 1;
    return c;
  }, [tasks]);

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
  const add = (fn: (id: string, pid: string | null) => Promise<unknown>) =>
    async (id: string) => {
      const res = (await fn(id, projectId)) as { error?: string };
      if (res?.error) toast.error(res.error);
      else refresh();
    };
  const remove = (fn: (id: string, pid: string | null) => Promise<unknown>) =>
    async (id: string) => {
      const res = (await fn(id, null)) as { error?: string };
      if (res?.error) toast.error(res.error);
      else refresh();
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

  if (isPending)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading project…
      </div>
    );
  if (!project)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">Project not found.</p>
        <Link
          href={`/p/${propertyId}/projects`}
          className="text-sm text-foreground underline underline-offset-4"
        >
          Back to projects
        </Link>
      </div>
    );

  const breadcrumb = (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] tracking-tight"
    >
      <Link
        href={`/p/${propertyId}/projects`}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        Projects
      </Link>
      <ChevronRight
        className="size-3.5 shrink-0 text-muted-foreground/60"
        aria-hidden="true"
      />
      <span className="flex min-w-0 items-center gap-1.5 truncate text-foreground">
        {project.icon ? (
          <span className="shrink-0 text-sm leading-none">{project.icon}</span>
        ) : (
          <span
            className={cn("size-2 shrink-0 rounded-full", DOT[project.color])}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{project.name}</span>
      </span>
    </nav>
  );

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {project.icon ? (
          <span className="shrink-0 text-[1.375rem] leading-none">
            {project.icon}
          </span>
        ) : (
          <span
            className={cn("size-3 shrink-0 rounded-sm", DOT[project.color])}
            aria-hidden="true"
          />
        )}
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
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/45",
            ws.title,
          )}
          placeholder="Untitled project"
        />
      </div>

      <WorkspaceDescription
        value={project.description}
        onSave={commitDescription}
      />

      <MetadataRow>
        <MetadataItem label="Status">
          <StatusMenu status={project.status} onSelect={setStatus} inline />
        </MetadataItem>
        <MetadataItem label="Health">
          <HealthValue
            status={project.status}
            targetDate={project.target_date}
            done={counts.done}
            total={tasks.length}
            inline
          />
        </MetadataItem>
        <MetadataItem label="Issues">
          <Link
            href={`/p/${propertyId}/tasks?project=${projectId}`}
            className="inline-flex items-center gap-1 text-foreground transition-colors hover:text-foreground/80"
          >
            <Layers className="size-3.5 text-muted-foreground" strokeWidth={1.5} />
            <span className="tabular-nums">{tasks.length}</span>
          </Link>
        </MetadataItem>
        {linkedSpaces.length > 0 ? (
          <MetadataItem label="Spaces">
            <span className="tabular-nums">{linkedSpaces.length}</span>
          </MetadataItem>
        ) : null}
        {project.target_date ? (
          <MetadataItem label="Target">
            <RailDate value={project.target_date} />
          </MetadataItem>
        ) : null}
      </MetadataRow>

      <ScopeStatStrip
        propertyId={propertyId}
        scope={{ kind: "project", id: projectId }}
      />

      <CatchUpBanner
        propertyId={propertyId}
        subjectKind="project"
        subjectId={projectId}
      />

      <div className="flex flex-col gap-1.5">
        <EntityLabelsRow
          propertyId={propertyId}
          entityKind="project"
          entityId={projectId}
        />
      </div>
    </div>
  );

  const tabs: WorkspaceTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="flex flex-col gap-8">
          <ProgressOverview tasks={tasks} />
        </div>
      ),
    },
    {
      id: "tasks",
      label: "Tasks",
      count: tasks.length,
      content: (
        <TasksPanel
          propertyId={propertyId}
          tasks={tasks}
          candidates={taskCandidates}
          onAdd={add(setTaskProject)}
          onRemove={remove(setTaskProject)}
        />
      ),
    },
    {
      id: "docs",
      label: "Docs",
      count: docs.length,
      content: (
        <DocsPanel
          propertyId={propertyId}
          docs={docs}
          candidates={docCandidates}
          onAdd={add(setDocumentProject)}
          onRemove={remove(setDocumentProject)}
        />
      ),
    },
    {
      id: "members",
      label: "Contributors",
      count: contributors.length,
      content: <Contributors people={contributors} />,
    },
  ];

  const rightRail = (
    <div className="flex flex-col">
      <RailGroup label="Properties">
        <PropertyRow label="Status">
          <StatusMenu status={project.status} onSelect={setStatus} />
        </PropertyRow>
        <PropertyRow label="Health">
          <HealthValue
            status={project.status}
            targetDate={project.target_date}
            done={counts.done}
            total={tasks.length}
          />
        </PropertyRow>
        <PropertyRow label="Members">
          {contributors.length > 0 ? (
            <div className="px-1.5 py-0.5">
              <AvatarRow people={contributors} />
            </div>
          ) : (
            <span className="px-1.5 py-1 text-[0.8125rem] text-muted-foreground">
              None
            </span>
          )}
        </PropertyRow>
        <PropertyRow label="Issues">
          <Link
            href={`/p/${propertyId}/tasks?project=${projectId}`}
            className={railValueClass}
          >
            <Layers className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="tabular-nums">{tasks.length}</span>
          </Link>
        </PropertyRow>
        <PropertyRow label="Dates">
          <DatesValue start={project.start_date} target={project.target_date} />
        </PropertyRow>
        <PropertyRow label="Teams">
          <SpacesPicker
            allSpaces={allSpaces}
            linkedSpaces={linkedSpaces}
            onToggle={toggleSpace}
          />
        </PropertyRow>
        <PropertyRow label="Created">
          <span className="px-1.5 py-1">
            <RailDate value={project.created_at} />
          </span>
        </PropertyRow>
      </RailGroup>

      <RailGroup label="Progress">
        <RailProgress done={counts.done} total={tasks.length} />
      </RailGroup>

      <RailGroup label="Activity">
        <ActivityFeed events={activity.slice(0, 6)} pending={activityPending} />
      </RailGroup>
    </div>
  );

  const overflow = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" size="icon-sm" variant="ghost" title="More" />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem onClick={handleArchive}>
          <Archive className="size-3.5" />
          <span className="flex-1">Archive project</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <WorkspaceShell
      breadcrumb={breadcrumb}
      header={header}
      headerActions={overflow}
      tabs={tabs}
      rightRail={rightRail}
    />
  );
}

function AvatarRow({
  people,
}: {
  people: { id: string; name: string | null; avatarUrl: string | null }[];
}) {
  const shown = people.slice(0, 5);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((p) => (
          <Avatar
            key={p.id}
            className="size-6 ring-2 ring-background"
            title={p.name ?? undefined}
          >
            {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-[0.5625rem]">
              {(p.name ?? "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {extra > 0 ? (
        <span className="ml-2 text-[0.75rem] text-muted-foreground tabular-nums">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

function HealthValue({
  status,
  targetDate,
  done,
  total,
  inline,
}: {
  status: ProjectStatus;
  targetDate: string | null;
  done: number;
  total: number;
  inline?: boolean;
}) {
  const health = projectHealth({
    status,
    target_date: targetDate,
    done,
    total,
  });
  const meta = HEALTH_META[health];
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 tracking-tight text-foreground",
        inline ? "text-[0.8125rem]" : "px-1.5 py-1 text-[0.8125rem]",
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

function DatesValue({
  start,
  target,
}: {
  start: string | null;
  target: string | null;
}) {
  if (!start && !target)
    return (
      <span className="px-1.5 py-1 text-[0.8125rem] text-muted-foreground">—</span>
    );
  return (
    <span className="flex items-center gap-1 px-1.5 py-1">
      <RailDate value={start} />
      <span className="text-muted-foreground">→</span>
      <RailDate value={target} />
    </span>
  );
}

function Contributors({
  people,
}: {
  people: { id: string; name: string | null; avatarUrl: string | null }[];
}) {
  if (people.length === 0)
    return (
      <p className="py-4 text-[0.8125rem] text-muted-foreground">
        No one is assigned to this project&apos;s tasks yet.
      </p>
    );
  return (
    <ul
      role="list"
      className="flex flex-col divide-y divide-border/40 border-t border-border/40"
    >
      {people.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-1 py-2.5">
          <Avatar className="size-7">
            {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-[0.625rem]">
              {(p.name ?? "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
            {p.name ?? "Unnamed"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatusMenu({
  status,
  onSelect,
  inline,
}: {
  status: ProjectStatus;
  onSelect: (s: ProjectStatus) => void;
  inline?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={inline ? "inline-flex items-center gap-1.5" : railValueClass}
          />
        }
      >
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} />
        {STATUS_LABEL[status]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
          <DropdownMenuItem key={s} onClick={() => onSelect(s)}>
            <span className={cn("size-2 rounded-full", STATUS_DOT[s])} />
            <span className="flex-1">{STATUS_LABEL[s]}</span>
            {s === status ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SpacesPicker({
  allSpaces,
  linkedSpaces,
  onToggle,
}: {
  allSpaces: { id: string; name: string; color: EntityColor }[];
  linkedSpaces: { id: string; name: string; color: EntityColor }[];
  onToggle: (spaceId: string) => void;
}) {
  const linkedIds = new Set(linkedSpaces.map((s) => s.id));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {linkedSpaces.map((s) => (
          <span
            key={s.id}
            className="flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[0.75rem] tracking-tight text-foreground"
          >
            <span className={cn("size-1.5 rounded-full", DOT[s.color])} />
            {s.name}
          </span>
        ))}
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="rounded-full border border-dashed border-border/70 px-2.5 py-1 text-[0.75rem] tracking-tight text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
              />
            }
          >
            {linkedSpaces.length === 0 ? "Add spaces" : "Edit spaces"}
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-56 p-1.5">
            {allSpaces.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                No spaces yet — create one in the sidebar.
              </p>
            ) : (
              <ul className="flex max-h-64 flex-col overflow-y-auto">
                {allSpaces.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onToggle(s.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span className={cn("size-2 rounded-full", DOT[s.color])} />
                      <span className="min-w-0 flex-1 truncate tracking-tight">
                        {s.name}
                      </span>
                      {linkedIds.has(s.id) ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
