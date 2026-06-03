"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileText, Plus, Search, Trash2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { StatusIcon } from "@/components/tasks/task-icons";
import type { EntityColor, ProjectStatus, TaskStatus } from "@/lib/db/types";
import { teamsQueryOptions } from "@/lib/query/project-queries";
import {
  documentsQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import {
  archiveProject,
  setDocumentProject,
  setProjectTeams,
  setTaskProject,
  updateProject,
} from "./actions";

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
const TEAM_DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

type ProjectDetailData = {
  project: {
    id: string;
    name: string;
    description: string | null;
    color: EntityColor;
    status: ProjectStatus;
  } | null;
  teamIds: string[];
  tasks: { id: string; title: string; status: TaskStatus }[];
  docs: { id: string; title: string; updated_at: string }[];
};

function projectDetailQuery(projectId: string) {
  return {
    queryKey: ["project-detail", projectId] as const,
    queryFn: async (): Promise<ProjectDetailData> => {
      const supabase = createBrowserClient();
      const [proj, links, tasks, docs] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, description, color, status")
          .eq("id", projectId)
          .maybeSingle(),
        supabase
          .from("project_teams")
          .select("team_id")
          .eq("project_id", projectId),
        supabase
          .from("tasks")
          .select("id, title, status")
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
        teamIds: (links.data ?? []).map((l) => l.team_id),
        tasks: (tasks.data ?? []) as ProjectDetailData["tasks"],
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
  const openDocument = useOpenDocument(propertyId);
  const { data, isPending } = useQuery(projectDetailQuery(projectId));
  const { data: allTeams = [] } = useQuery(teamsQueryOptions(propertyId));
  const { data: allTasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { data: allDocs = [] } = useQuery(documentsQueryOptions(propertyId));

  const taskCandidates = useMemo(() => {
    const assigned = new Set((data?.tasks ?? []).map((t) => t.id));
    return allTasks
      .filter((t) => !assigned.has(t.id))
      .map((t) => ({ id: t.id, title: t.title }));
  }, [allTasks, data?.tasks]);
  const docCandidates = useMemo(() => {
    const assigned = new Set((data?.docs ?? []).map((d) => d.id));
    return allDocs
      .filter((d) => !assigned.has(d.id))
      .map((d) => ({ id: d.id, title: d.title }));
  }, [allDocs, data?.docs]);

  const project = data?.project;
  const [name, setName] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (project) setName(project.name);
  }, [project]);

  const linkedTeams = useMemo(
    () => allTeams.filter((t) => data?.teamIds.includes(t.id)),
    [allTeams, data?.teamIds],
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
    else refresh();
  }

  async function setStatus(status: ProjectStatus) {
    const res = await updateProject(projectId, { status });
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

  async function toggleTeam(teamId: string) {
    const current = data?.teamIds ?? [];
    const next = current.includes(teamId)
      ? current.filter((x) => x !== teamId)
      : [...current, teamId];
    const res = await setProjectTeams(projectId, next);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

  async function addTask(taskId: string) {
    const res = await setTaskProject(taskId, projectId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function removeTask(taskId: string) {
    const res = await setTaskProject(taskId, null);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function addDoc(documentId: string) {
    const res = await setDocumentProject(documentId, projectId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function removeDoc(documentId: string) {
    const res = await setDocumentProject(documentId, null);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

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

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <header className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Project
          </p>
          <div className="flex items-center gap-1.5">
            <StatusMenu status={project.status} onSelect={setStatus} />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title="Archive project"
              onClick={handleArchive}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-2.5 size-3 shrink-0 rounded",
              TEAM_DOT[project.color],
            )}
            aria-hidden="true"
          />
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
            className="min-w-0 flex-1 bg-transparent text-[2.5rem] leading-none font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="Untitled project"
          />
        </div>

        <TeamsPicker
          allTeams={allTeams}
          linkedTeams={linkedTeams}
          onToggle={toggleTeam}
        />
      </header>

      <hr className="my-10 border-border" />

      <div className="flex flex-col gap-14">
        <section>
          <EditorialHeading
            kicker="In this project"
            count={data?.tasks.length}
            action={
              <AddPicker
                label="Add tasks"
                candidates={taskCandidates}
                onAdd={addTask}
              />
            }
          >
            Tasks
          </EditorialHeading>
          {data && data.tasks.length > 0 ? (
            <ul
              role="list"
              className="flex flex-col divide-y divide-border/40 border-t border-border/40"
            >
              {data.tasks.map((t) => (
                <li key={t.id} className="group/row relative">
                  <Link
                    href={`/p/${propertyId}/tasks/${t.id}`}
                    className="flex items-center gap-3 rounded-md px-1 py-2.5 pr-9 transition-colors hover:bg-muted"
                  >
                    <StatusIcon status={t.status} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                      {t.title || "Untitled task"}
                    </span>
                  </Link>
                  <RemoveButton
                    label="Remove from project"
                    onClick={() => removeTask(t.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-[0.8125rem] text-muted-foreground">
              No tasks yet — use <span className="font-medium">Add tasks</span> to
              pull work into this project.
            </p>
          )}
        </section>

        <section>
          <EditorialHeading
            kicker="In this project"
            count={data?.docs.length}
            action={
              <AddPicker
                label="Add docs"
                candidates={docCandidates}
                onAdd={addDoc}
              />
            }
          >
            Documents
          </EditorialHeading>
          {data && data.docs.length > 0 ? (
            <ul
              role="list"
              className="flex flex-col divide-y divide-border/40 border-t border-border/40"
            >
              {data.docs.map((d) => (
                <li key={d.id} className="group/row relative">
                  <Link
                    href={documentHref(propertyId, d.id)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                        return;
                      e.preventDefault();
                      openDocument(d.id);
                    }}
                    className="flex items-center gap-3 rounded-md px-1 py-2.5 pr-9 transition-colors hover:bg-muted"
                  >
                    <FileText
                      strokeWidth={1.5}
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                      {d.title || "Untitled"}
                    </span>
                  </Link>
                  <RemoveButton
                    label="Remove from project"
                    onClick={() => removeDoc(d.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-[0.8125rem] text-muted-foreground">
              No documents yet — use <span className="font-medium">Add docs</span>{" "}
              to link pages here.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function StatusMenu({
  status,
  onSelect,
}: {
  status: ProjectStatus;
  onSelect: (s: ProjectStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" size="sm" variant="outline">
            <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
            {STATUS_LABEL[status]}
          </Button>
        }
      />
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

function TeamsPicker({
  allTeams,
  linkedTeams,
  onToggle,
}: {
  allTeams: { id: string; name: string; color: EntityColor }[];
  linkedTeams: { id: string; name: string; color: EntityColor }[];
  onToggle: (teamId: string) => void;
}) {
  const linkedIds = new Set(linkedTeams.map((t) => t.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {linkedTeams.map((t) => (
        <span
          key={t.id}
          className="flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[0.75rem] tracking-tight text-foreground"
        >
          <span className={cn("size-1.5 rounded-full", TEAM_DOT[t.color])} />
          {t.name}
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
          {linkedTeams.length === 0 ? "Add teams" : "Edit teams"}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-56 p-1.5">
          {allTeams.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No teams yet — create one in the sidebar.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col overflow-y-auto">
              {allTeams.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(t.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span
                      className={cn("size-2 rounded-full", TEAM_DOT[t.color])}
                    />
                    <span className="min-w-0 flex-1 truncate tracking-tight">
                      {t.name}
                    </span>
                    {linkedIds.has(t.id) ? (
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
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-background hover:text-destructive"
    >
      <X className="size-3.5" />
    </button>
  );
}

function EditorialHeading({
  kicker,
  count,
  action,
  children,
}: {
  kicker: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-3 border-b border-border pb-3">
      <div className="flex flex-col gap-1">
        <span className="text-[0.625rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
          {kicker}
        </span>
        <h2 className="text-[1.375rem] font-semibold tracking-tight text-foreground">
          {children}
        </h2>
      </div>
      <div className="flex items-center gap-3">
        {typeof count === "number" ? (
          <span className="text-[0.75rem] text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
        {action}
      </div>
    </div>
  );
}

/** Search-and-add popover used to assign tasks / documents to a project. */
function AddPicker({
  label,
  candidates,
  onAdd,
}: {
  label: string;
  candidates: { id: string; title: string }[];
  onAdd: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = candidates
    .filter((c) =>
      q.trim() ? (c.title || "").toLowerCase().includes(q.trim().toLowerCase()) : true,
    )
    .slice(0, 8);
  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" size="sm" variant="outline" />}
      >
        <Plus className="size-4" />
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <ul className="mt-1.5 max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              Nothing to add
            </li>
          ) : (
            filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onAdd(c.id)}
                  className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm tracking-tight transition-colors hover:bg-muted"
                >
                  {c.title || "Untitled"}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
