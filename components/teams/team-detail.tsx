"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileText, FolderKanban, Plus, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusIcon } from "@/components/tasks/task-icons";
import type { EntityColor, TaskStatus } from "@/lib/db/types";
import {
  documentsQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import {
  archiveTeam,
  setDocumentTeam,
  setTaskTeam,
  updateTeam,
} from "@/components/projects/actions";

const COLORS: EntityColor[] = ["slate", "blue", "green", "amber", "rose", "violet"];
const DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

type TeamDetailData = {
  team: { id: string; name: string; color: EntityColor } | null;
  projects: { id: string; name: string; color: EntityColor }[];
  tasks: { id: string; title: string; status: TaskStatus }[];
  docs: { id: string; title: string }[];
};

function teamDetailQuery(teamId: string) {
  return {
    queryKey: ["team-detail", teamId] as const,
    queryFn: async (): Promise<TeamDetailData> => {
      const supabase = createBrowserClient();
      const [team, links, tasks, docs] = await Promise.all([
        supabase
          .from("teams")
          .select("id, name, color")
          .eq("id", teamId)
          .maybeSingle(),
        supabase.from("project_teams").select("project_id").eq("team_id", teamId),
        supabase
          .from("tasks")
          .select("id, title, status")
          .eq("team_id", teamId)
          .order("position", { ascending: true }),
        supabase
          .from("documents")
          .select("id, title")
          .eq("team_id", teamId)
          .is("archived_at", null)
          .order("updated_at", { ascending: false }),
      ]);
      let projects: TeamDetailData["projects"] = [];
      const projectIds = (links.data ?? []).map((l) => l.project_id);
      if (projectIds.length > 0) {
        const { data } = await supabase
          .from("projects")
          .select("id, name, color")
          .in("id", projectIds);
        projects = (data ?? []) as TeamDetailData["projects"];
      }
      return {
        team: (team.data as TeamDetailData["team"]) ?? null,
        projects,
        tasks: (tasks.data ?? []) as TeamDetailData["tasks"],
        docs: (docs.data ?? []) as TeamDetailData["docs"],
      };
    },
  };
}

export function TeamDetail({
  propertyId,
  teamId,
}: {
  propertyId: string;
  teamId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const openDocument = useOpenDocument(propertyId);
  const { data, isPending } = useQuery(teamDetailQuery(teamId));
  const { data: allTasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { data: allDocs = [] } = useQuery(documentsQueryOptions(propertyId));

  const team = data?.team;
  const [name, setName] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (team) setName(team.name);
  }, [team]);

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

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["team-detail", teamId] });
  }

  async function commitName() {
    const next = name.trim();
    if (!team || !next || next === team.name) {
      if (team) setName(team.name);
      return;
    }
    const res = await updateTeam(teamId, { name: next });
    if ("error" in res) toast.error(res.error);
    else {
      refresh();
      void qc.invalidateQueries({ queryKey: ["teams", propertyId] });
    }
  }
  async function recolor(color: EntityColor) {
    const res = await updateTeam(teamId, { color });
    if ("error" in res) toast.error(res.error);
    else {
      refresh();
      void qc.invalidateQueries({ queryKey: ["teams", propertyId] });
    }
  }
  async function addTask(id: string) {
    const res = await setTaskTeam(id, teamId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function removeTask(id: string) {
    const res = await setTaskTeam(id, null);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function addDoc(id: string) {
    const res = await setDocumentTeam(id, teamId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function removeDoc(id: string) {
    const res = await setDocumentTeam(id, null);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function handleArchive() {
    if (!window.confirm("Archive this team?")) return;
    const res = await archiveTeam(teamId);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["teams", propertyId] });
    router.push(`/p/${propertyId}/projects`);
  }

  if (isPending)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading team…
      </div>
    );
  if (!team)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">Team not found.</p>
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
            Team
          </p>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title="Archive team"
            onClick={handleArchive}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        <div className="flex items-start gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Team color"
                  className="mt-2.5 shrink-0"
                />
              }
            >
              <span className={cn("block size-3 rounded", DOT[team.color])} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6}>
              {COLORS.map((c) => (
                <DropdownMenuItem
                  key={c}
                  onClick={() => void recolor(c)}
                  className="gap-2 capitalize"
                >
                  <span className={cn("size-3 rounded", DOT[c])} />
                  <span className="flex-1">{c}</span>
                  {team.color === c ? <Check className="size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setName(team.name);
                e.currentTarget.blur();
              }
            }}
            aria-label="Team name"
            className="min-w-0 flex-1 bg-transparent text-[2.5rem] leading-none font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="Untitled team"
          />
        </div>
      </header>

      <hr className="my-10 border-border" />

      <div className="flex flex-col gap-14">
        {data && data.projects.length > 0 ? (
          <section>
            <Heading kicker="Spanning" count={data.projects.length}>
              Projects
            </Heading>
            <ul
              role="list"
              className="flex flex-col divide-y divide-border/40 border-t border-border/40"
            >
              {data.projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/p/${propertyId}/projects/${p.id}`}
                    className="flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-muted"
                  >
                    <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                      {p.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <Heading
            kicker="On this team"
            count={data?.tasks.length}
            action={
              <AddPicker label="Add tasks" candidates={taskCandidates} onAdd={addTask} />
            }
          >
            Tasks
          </Heading>
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
                  <Remove onClick={() => removeTask(t.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-[0.8125rem] text-muted-foreground">
              No tasks on this team yet.
            </p>
          )}
        </section>

        <section>
          <Heading
            kicker="On this team"
            count={data?.docs.length}
            action={
              <AddPicker label="Add docs" candidates={docCandidates} onAdd={addDoc} />
            }
          >
            Documents
          </Heading>
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
                  <Remove onClick={() => removeDoc(d.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-[0.8125rem] text-muted-foreground">
              No documents on this team yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove from team"
      title="Remove from team"
      onClick={onClick}
      className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-background hover:text-destructive"
    >
      <X className="size-3.5" />
    </button>
  );
}

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
      <PopoverTrigger render={<Button type="button" size="sm" variant="outline" />}>
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

function Heading({
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
