"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Check, Layers, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { EntityColor } from "@/lib/db/types";
import {
  documentsQueryOptions,
  propertyMembersQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { spaceMemberIdsQueryOptions } from "@/lib/query/project-queries";
import {
  archiveSpace,
  setDocumentSpace,
  setTaskSpace,
  updateSpace,
} from "@/components/projects/actions";
import {
  PropertyRow,
  RailDate,
  RailGroup,
  RailProgress,
  railValueClass,
  WorkspaceShell,
  type WorkspaceTab,
} from "@/components/projects/workspace-shell";
import {
  ActivityFeed,
  DocsPanel,
  ProgressOverview,
  ProjectProgressList,
  TasksPanel,
  type ScopedTask,
} from "@/components/projects/workspace-panels";
import { activityQuery } from "@/lib/query/activity-queries";
import { SpaceMembersPanel } from "./space-members-panel";
import { SpaceChannelsPanel } from "./space-channels-panel";

const COLORS: EntityColor[] = ["slate", "blue", "green", "amber", "rose", "violet"];
const DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

type SpaceDetailData = {
  space: {
    id: string;
    name: string;
    color: EntityColor;
    icon: string | null;
    created_at: string | null;
  } | null;
  projects: {
    id: string;
    name: string;
    color: EntityColor;
    done: number;
    total: number;
  }[];
  tasks: ScopedTask[];
  docs: { id: string; title: string }[];
};

function spaceDetailQuery(spaceId: string) {
  return {
    queryKey: ["space-detail", spaceId] as const,
    queryFn: async (): Promise<SpaceDetailData> => {
      const supabase = createBrowserClient();
      const [space, links, tasks, docs] = await Promise.all([
        supabase
          .from("spaces")
          .select("id, name, color, icon, created_at")
          .eq("id", spaceId)
          .maybeSingle(),
        supabase.from("project_spaces").select("project_id").eq("space_id", spaceId),
        supabase
          .from("tasks")
          .select("id, title, status")
          .eq("space_id", spaceId)
          .order("position", { ascending: true }),
        supabase
          .from("documents")
          .select("id, title")
          .eq("space_id", spaceId)
          .is("archived_at", null)
          .order("updated_at", { ascending: false }),
      ]);
      let projects: SpaceDetailData["projects"] = [];
      const ids = (links.data ?? []).map((l) => l.project_id);
      if (ids.length > 0) {
        // Pull the linked projects and, in parallel, every task on them so we
        // can show each project's completion (done / total) on the overview.
        const [projRows, projTasks] = await Promise.all([
          supabase.from("projects").select("id, name, color").in("id", ids),
          supabase.from("tasks").select("project_id, status").in("project_id", ids),
        ]);
        const agg = new Map<string, { done: number; total: number }>();
        for (const t of (projTasks.data ?? []) as {
          project_id: string;
          status: string;
        }[]) {
          const a = agg.get(t.project_id) ?? { done: 0, total: 0 };
          a.total += 1;
          if (t.status === "done") a.done += 1;
          agg.set(t.project_id, a);
        }
        projects = (
          (projRows.data ?? []) as {
            id: string;
            name: string;
            color: EntityColor;
          }[]
        ).map((p) => ({
          ...p,
          done: agg.get(p.id)?.done ?? 0,
          total: agg.get(p.id)?.total ?? 0,
        }));
      }
      return {
        space: (space.data as SpaceDetailData["space"]) ?? null,
        projects,
        tasks: (tasks.data ?? []) as ScopedTask[],
        docs: (docs.data ?? []) as SpaceDetailData["docs"],
      };
    },
  };
}

export function SpaceDetail({
  propertyId,
  spaceId,
}: {
  propertyId: string;
  spaceId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isPending } = useQuery(spaceDetailQuery(spaceId));
  const { data: activity = [], isPending: activityPending } = useQuery(
    activityQuery(propertyId, { space: spaceId }),
  );
  const { data: allTasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { data: allDocs = [] } = useQuery(documentsQueryOptions(propertyId));
  const { data: people = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: memberIds = [] } = useQuery(spaceMemberIdsQueryOptions(spaceId));
  const roster = useMemo(() => {
    const s = new Set(memberIds);
    return people.filter((p) => s.has(p.id));
  }, [people, memberIds]);

  const space = data?.space;
  const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks]);
  const docs = useMemo(() => data?.docs ?? [], [data?.docs]);
  const doneCount = useMemo(
    () => tasks.filter((t) => t.status === "done").length,
    [tasks],
  );

  const [name, setName] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (space) setName(space.name);
  }, [space]);

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

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["space-detail", spaceId] });
  }
  async function commitName() {
    const next = name.trim();
    if (!space || !next || next === space.name) {
      if (space) setName(space.name);
      return;
    }
    const res = await updateSpace(spaceId, { name: next });
    if ("error" in res) toast.error(res.error);
    else {
      refresh();
      void qc.invalidateQueries({ queryKey: ["spaces", propertyId] });
    }
  }
  async function recolor(color: EntityColor) {
    const res = await updateSpace(spaceId, { color });
    if ("error" in res) toast.error(res.error);
    else {
      refresh();
      void qc.invalidateQueries({ queryKey: ["spaces", propertyId] });
    }
  }
  const add = (fn: (id: string, sid: string | null) => Promise<unknown>) =>
    async (id: string) => {
      const res = (await fn(id, spaceId)) as { error?: string };
      if (res?.error) toast.error(res.error);
      else refresh();
    };
  const remove = (fn: (id: string, sid: string | null) => Promise<unknown>) =>
    async (id: string) => {
      const res = (await fn(id, null)) as { error?: string };
      if (res?.error) toast.error(res.error);
      else refresh();
    };
  async function handleArchive() {
    if (!window.confirm("Archive this space?")) return;
    const res = await archiveSpace(spaceId);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["spaces", propertyId] });
    router.push(`/p/${propertyId}/projects`);
  }

  if (isPending)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading space…
      </div>
    );
  if (!space)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">Space not found.</p>
        <Link
          href={`/p/${propertyId}/home`}
          className="text-sm text-foreground underline underline-offset-4"
        >
          Back home
        </Link>
      </div>
    );

  const header = (
    <div className="flex flex-col gap-5">
      <p className="text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Space
      </p>
      <div className="flex items-center gap-3">
        {space.icon ? (
          <span className="shrink-0 text-2xl leading-none">{space.icon}</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button type="button" aria-label="Space color" className="shrink-0" />
              }
            >
              <span className={cn("block size-3 rounded", DOT[space.color])} />
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
                  {space.color === c ? <Check className="size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setName(space.name);
              e.currentTarget.blur();
            }
          }}
          aria-label="Space name"
          className="min-w-0 flex-1 bg-transparent text-[2.25rem] leading-none font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
          placeholder="Untitled space"
        />
      </div>
    </div>
  );

  const tabs: WorkspaceTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="flex flex-col gap-10">
          <ProgressOverview tasks={tasks} />
          <section className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[0.8125rem] font-medium tracking-tight text-foreground">
                Projects
              </h3>
              <span className="text-[0.75rem] tabular-nums text-muted-foreground">
                {data?.projects.length ?? 0}
              </span>
            </div>
            <ProjectProgressList
              propertyId={propertyId}
              projects={data?.projects ?? []}
            />
          </section>
          <section className="flex flex-col gap-4">
            <h3 className="text-[0.8125rem] font-medium tracking-tight text-foreground">
              Activity
            </h3>
            <ActivityFeed events={activity} pending={activityPending} />
          </section>
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
          onAdd={add(setTaskSpace)}
          onRemove={remove(setTaskSpace)}
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
          onAdd={add(setDocumentSpace)}
          onRemove={remove(setDocumentSpace)}
        />
      ),
    },
    {
      id: "members",
      label: "Members",
      content: <SpaceMembersPanel propertyId={propertyId} spaceId={spaceId} />,
    },
    {
      id: "channels",
      label: "Channels",
      content: <SpaceChannelsPanel propertyId={propertyId} spaceId={spaceId} />,
    },
  ];

  const rightRail = (
    <div className="flex flex-col">
      <RailGroup label="Properties">
        <PropertyRow label="Members">
          {roster.length > 0 ? (
            <div className="flex items-center gap-2 px-1.5 py-0.5">
              <div className="flex -space-x-1.5">
                {roster.slice(0, 5).map((p) => (
                  <Avatar
                    key={p.id}
                    className="size-6 ring-2 ring-background"
                    title={p.name ?? undefined}
                  >
                    {p.avatarUrl ? (
                      <AvatarImage src={p.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[0.5625rem]">
                      {(p.name ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              {roster.length > 5 ? (
                <span className="text-[0.75rem] text-muted-foreground tabular-nums">
                  +{roster.length - 5}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="px-1.5 py-1 text-[0.8125rem] text-muted-foreground">
              No members yet
            </span>
          )}
        </PropertyRow>
        <PropertyRow label="Issues">
          <Link
            href={`/p/${propertyId}/tasks?space=${spaceId}`}
            className={railValueClass}
          >
            <Layers className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="tabular-nums">{tasks.length}</span>
          </Link>
        </PropertyRow>
        <PropertyRow label="Documents">
          <span className="px-1.5 py-1 text-[0.8125rem] tracking-tight text-foreground tabular-nums">
            {docs.length}
          </span>
        </PropertyRow>
        <PropertyRow label="Created">
          <span className="px-1.5 py-1">
            <RailDate value={space.created_at} />
          </span>
        </PropertyRow>
      </RailGroup>

      <RailGroup label="Progress">
        <RailProgress done={doneCount} total={tasks.length} />
      </RailGroup>

      {data && data.projects.length > 0 ? (
        <RailGroup label="Projects">
          <div className="flex flex-wrap gap-1">
            {data.projects.map((p) => (
              <Link
                key={p.id}
                href={`/p/${propertyId}/projects/${p.id}`}
                className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[0.6875rem] tracking-tight text-foreground hover:border-foreground/25"
              >
                <span className={cn("size-1.5 rounded-full", DOT[p.color])} />
                {p.name}
              </Link>
            ))}
          </div>
        </RailGroup>
      ) : null}
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
          <span className="flex-1">Archive space</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <WorkspaceShell
      header={header}
      headerActions={overflow}
      tabs={tabs}
      rightRail={rightRail}
    />
  );
}
