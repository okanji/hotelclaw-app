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
  pinSpaceResource,
  setDocumentSpace,
  setTaskSpace,
  unpinSpaceResource,
  updateSpace,
} from "@/components/projects/actions";
import { unpinFormFromSpace } from "@/components/forms/share-actions";
import {
  MetadataItem,
  MetadataRow,
  OverviewSection,
  PropertyRow,
  RailDate,
  RailGroup,
  RailProgress,
  railValueClass,
  WorkspaceShell,
  ws,
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
import { SpacePinnedResources } from "./space-pinned-resources";
import { WorkspaceDescription } from "@/components/projects/workspace-description";
import { ScopeStatStrip } from "@/components/insights/scope-stat-strip";
import { CatchUpBanner } from "@/components/insights/catch-up-banner";
import { LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";

const COLORS = LABEL_COLORS;
const DOT = LABEL_DOT;

type SpaceDetailData = {
  space: {
    id: string;
    name: string;
    description: string | null;
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
  pinnedDocs: { id: string; title: string }[];
  pinnedForms: { id: string; title: string; status: string }[];
};

function spaceDetailQuery(spaceId: string) {
  return {
    queryKey: ["space-detail", spaceId] as const,
    queryFn: async (): Promise<SpaceDetailData> => {
      const supabase = createBrowserClient();
      const [space, links, tasks, docs, pins] = await Promise.all([
        supabase
          .from("spaces")
          .select("id, name, description, color, icon, created_at")
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
        supabase
          .from("space_pinned_resources")
          .select("document_id, form_id, position")
          .eq("space_id", spaceId)
          .order("position", { ascending: true }),
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
      const spaceDocs = (docs.data ?? []) as SpaceDetailData["docs"];
      const docById = new Map(spaceDocs.map((d) => [d.id, d]));
      const pinRows = (pins.data ?? []) as {
        document_id: string | null;
        form_id: string | null;
        position: number;
      }[];
      const pinnedDocs = pinRows
        .map((p) => (p.document_id ? docById.get(p.document_id) : undefined))
        .filter((d): d is { id: string; title: string } => d != null);

      // Pinned forms live in their own table; fetch the few pinned ones by id.
      let pinnedForms: SpaceDetailData["pinnedForms"] = [];
      const formIds = pinRows.map((p) => p.form_id).filter((id): id is string => !!id);
      if (formIds.length > 0) {
        const { data: formRows } = await supabase
          .from("forms")
          .select("id, title, status")
          .in("id", formIds);
        const byId = new Map((formRows ?? []).map((f) => [f.id, f]));
        pinnedForms = formIds.flatMap((id) => {
          const f = byId.get(id);
          return f ? [{ id: f.id, title: f.title, status: f.status as string }] : [];
        });
      }

      return {
        space: (space.data as SpaceDetailData["space"]) ?? null,
        projects,
        tasks: (tasks.data ?? []) as ScopedTask[],
        docs: spaceDocs,
        pinnedDocs,
        pinnedForms,
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
  const pinnedDocs = useMemo(() => data?.pinnedDocs ?? [], [data?.pinnedDocs]);
  const pinnedIds = useMemo(
    () => new Set(pinnedDocs.map((d) => d.id)),
    [pinnedDocs],
  );
  const doneCount = useMemo(
    () => tasks.filter((t) => t.status === "done").length,
    [tasks],
  );

  const [name, setName] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
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
  const pinSpaceCandidates = useMemo(() => {
    return docs
      .filter((d) => !pinnedIds.has(d.id))
      .map((d) => ({ id: d.id, title: d.title }));
  }, [docs, pinnedIds]);
  const pinWorkspaceCandidates = useMemo(() => {
    const inSpace = new Set(docs.map((d) => d.id));
    return allDocs
      .filter((d) => !inSpace.has(d.id) && !pinnedIds.has(d.id))
      .map((d) => ({ id: d.id, title: d.title }));
  }, [allDocs, docs, pinnedIds]);

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
  async function commitDescription(description: string | null) {
    const res = await updateSpace(spaceId, { description });
    if ("error" in res) return { error: res.error };
    refresh();
    return {};
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
  async function handlePin(documentId: string) {
    const res = await pinSpaceResource(spaceId, documentId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function handleUnpin(documentId: string) {
    const res = await unpinSpaceResource(spaceId, documentId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function handleUnpinForm(formId: string) {
    const res = await unpinFormFromSpace(spaceId, formId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
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

  const breadcrumb = (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 text-sm tracking-tight"
    >
      <Link
        href={`/p/${propertyId}/projects`}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        Spaces
      </Link>
      <ChevronRight
        className="size-3.5 shrink-0 text-muted-foreground/60"
        aria-hidden="true"
      />
      <span className="flex min-w-0 items-center gap-1.5 truncate text-foreground">
        {space.icon ? (
          <span className="shrink-0 text-sm leading-none">{space.icon}</span>
        ) : (
          <span
            className={cn("size-2 shrink-0 rounded-full", DOT[space.color])}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{space.name}</span>
      </span>
    </nav>
  );

  const header = (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {space.icon ? (
          <span className="shrink-0 text-2xl leading-none">{space.icon}</span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Space color"
                  className="shrink-0 rounded p-0.5 transition-colors hover:bg-muted/50"
                />
              }
            >
              <span className={cn("block size-3 rounded-sm", DOT[space.color])} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6}>
              {COLORS.map((c) => (
                <DropdownMenuItem
                  key={c}
                  onClick={() => void recolor(c)}
                  className="gap-2 capitalize"
                >
                  <span className={cn("size-3 rounded-sm", DOT[c])} />
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
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/45",
            ws.title,
          )}
          placeholder="Untitled space"
        />
      </div>

      <WorkspaceDescription
        value={space.description}
        onSave={commitDescription}
      />

      <Link
        href={`/p/${propertyId}/tasks?space=${spaceId}`}
        title={`${tasks.length} issues`}
        className="inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-sm tracking-tight text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <Layers className="size-3.5" strokeWidth={1.5} />
        <span className="tabular-nums">{tasks.length}</span>
      </Link>

      <MetadataRow>
        <MetadataItem label="Members">
          {roster.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1">
                {roster.slice(0, 3).map((p) => (
                  <Avatar
                    key={p.id}
                    className="size-5 ring-1 ring-background"
                    title={p.name ?? undefined}
                  >
                    {p.avatarUrl ? (
                      <AvatarImage src={p.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[0.5rem]">
                      {(p.name ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              {roster.length > 3 ? (
                <span className="text-muted-foreground tabular-nums">
                  +{roster.length - 3}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-muted-foreground">No members</span>
          )}
        </MetadataItem>
        <MetadataItem label="Documents">
          <span className="tabular-nums">{docs.length}</span>
        </MetadataItem>
        {space.created_at ? (
          <MetadataItem label="Created">
            <RailDate value={space.created_at} />
          </MetadataItem>
        ) : null}
      </MetadataRow>

      <ScopeStatStrip
        propertyId={propertyId}
        scope={{ kind: "space", id: spaceId }}
      />

      <CatchUpBanner
        propertyId={propertyId}
        subjectKind="space"
        subjectId={spaceId}
      />
    </div>
  );

  const tabs: WorkspaceTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="flex flex-col gap-10">
          <ProgressOverview tasks={tasks} />
          <SpacePinnedResources
            propertyId={propertyId}
            spaceColor={space.color}
            pinnedIds={pinnedDocs.map((d) => d.id)}
            pinnedForms={data?.pinnedForms ?? []}
            onUnpinForm={handleUnpinForm}
            allDocs={allDocs}
            spaceDocs={pinSpaceCandidates}
            workspaceCandidates={pinWorkspaceCandidates}
            onPin={handlePin}
            onUnpin={handleUnpin}
            totalDocs={docs.length}
            onViewAllDocs={
              docs.length > 0 ? () => setActiveTab("docs") : undefined
            }
          />
          <OverviewSection
            title="Projects"
            action={
              (data?.projects.length ?? 0) > 0 ? (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {data?.projects.length}
                </span>
              ) : null
            }
          >
            <ProjectProgressList
              propertyId={propertyId}
              projects={data?.projects ?? []}
            />
          </OverviewSection>
        </div>
      ),
    },
    {
      id: "activity",
      label: "Activity",
      content: <ActivityFeed events={activity} pending={activityPending} />,
    },
    {
      id: "issues",
      label: "Issues",
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
          pinnedIds={pinnedIds}
          onPin={handlePin}
          onUnpin={handleUnpin}
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
            <div className="flex items-center gap-1.5 px-1.5 py-0.5">
              <div className="flex -space-x-1">
                {roster.slice(0, 5).map((p) => (
                  <Avatar
                    key={p.id}
                    className="size-5 ring-1 ring-background"
                    title={p.name ?? undefined}
                  >
                    {p.avatarUrl ? (
                      <AvatarImage src={p.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[0.5rem]">
                      {(p.name ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              {roster.length > 5 ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  +{roster.length - 5}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="px-1.5 py-0.5 text-sm text-muted-foreground">
              No members
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
          <span className="px-1.5 py-0.5 text-sm tracking-tight text-foreground tabular-nums">
            {docs.length}
          </span>
        </PropertyRow>
        <PropertyRow label="Created">
          <span className="px-1.5 py-0.5">
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
                className="flex items-center gap-1 rounded-full border border-border/50 px-2 py-0.5 text-sm tracking-tight text-foreground transition-colors hover:border-border hover:bg-muted/30"
              >
                <span className={cn("size-1.5 rounded-full", DOT[p.color])} />
                {p.name}
              </Link>
            ))}
          </div>
        </RailGroup>
      ) : null}

      <RailGroup
        label="Activity"
        action={
          activity.length > 0 ? (
            <button
              type="button"
              onClick={() => setActiveTab("activity")}
              className="text-sm tracking-tight text-muted-foreground transition-colors hover:text-foreground"
            >
              See all
            </button>
          ) : null
        }
      >
        <ActivityFeed
          events={activity.slice(0, 6)}
          pending={activityPending}
        />
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
          <span className="flex-1">Archive space</span>
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
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      rightRail={rightRail}
    />
  );
}
