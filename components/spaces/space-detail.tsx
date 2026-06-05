"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FolderKanban, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { EntityColor } from "@/lib/db/types";
import {
  documentsQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import {
  archiveSpace,
  setDocumentSpace,
  setTaskSpace,
  updateSpace,
} from "@/components/projects/actions";
import {
  WorkspaceShell,
  type WorkspaceTab,
} from "@/components/projects/workspace-shell";
import {
  DocsPanel,
  ProgressOverview,
  TasksPanel,
  type ScopedTask,
} from "@/components/projects/workspace-panels";
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
  } | null;
  projects: { id: string; name: string; color: EntityColor }[];
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
          .select("id, name, color, icon")
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
        const { data } = await supabase
          .from("projects")
          .select("id, name, color")
          .in("id", ids);
        projects = (data ?? []) as SpaceDetailData["projects"];
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
  const { data: allTasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { data: allDocs = [] } = useQuery(documentsQueryOptions(propertyId));

  const space = data?.space;
  const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks]);
  const docs = useMemo(() => data?.docs ?? [], [data?.docs]);

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
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Space
        </p>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="Archive space"
          onClick={handleArchive}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
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
          {data && data.projects.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[0.625rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
                In these projects
              </span>
              <ul className="flex flex-wrap gap-1.5">
                {data.projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/p/${propertyId}/projects/${p.id}`}
                      className="flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[0.75rem] tracking-tight text-foreground transition-colors hover:border-foreground/25"
                    >
                      <FolderKanban className="size-3" />
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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

  return <WorkspaceShell header={header} tabs={tabs} />;
}
