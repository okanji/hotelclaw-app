"use client";

import { useStatusCatalog } from "@/lib/query/status-queries";
import { isDone } from "@/lib/tasks/statuses";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Archive,
  Calendar,
  Check,
  ChevronRight,
  FileText,
  Layers,
  MoreHorizontal,
  Plus,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EntityColor } from "@/lib/db/types";
import {
  documentsQueryOptions,
  propertyMembersQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { spaceMemberIdsQueryOptions } from "@/lib/query/project-queries";
import { triageQueueQueryOptions } from "@/lib/query/triage-queries";
import {
  archiveSpace,
  pinSpaceResource,
  setDocumentSpace,
  setTaskSpace,
  unpinSpaceResource,
  updateSpace,
} from "@/components/projects/actions";
import { unpinFormFromSpace } from "@/components/forms/share-actions";
import { DailyOpsPanel, TeamScoreboard } from "./daily-ops-panel";
import { SpaceAutomationsPanel } from "./space-automations-panel";
import { useUrlTab } from "@/components/projects/workspace-shell";
import { FavoriteStar } from "@/components/gr8r/favorite-star";
import { Gi } from "@/components/gr8r/icon";
import { ProgBar } from "@/components/gr8r/home-glyphs";
import {
  TeamHeader,
  TeamIcon,
  TeamOverview,
  TeamPageShell,
  type TeamTab,
} from "@/components/gr8r/teams-detail";
import {
  DocsPanel,
  ProgressOverview,
  TasksPanel,
  type ScopedTask,
} from "@/components/projects/workspace-panels";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import {
  groupActivityByDay,
  useActivityLogRealtime,
  useActivityLookup,
  useViewerId,
  type ActivityLookup,
} from "@/components/activity/activity-log";
import {
  matchesFamily,
  type ActivityFamily,
} from "@/lib/query/activity-log-queries";
import type { PropertyMember } from "@/lib/query/section-queries";
import { FeedItem, G8Empty } from "@/components/gr8r/members-shared";
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
  /** Teams nested under this one (`spaces.parent_space_id`, 0071). */
  subTeams: { id: string; name: string; color: EntityColor; icon: string | null }[];
};

function spaceDetailQuery(spaceId: string) {
  return {
    queryKey: ["space-detail", spaceId] as const,
    queryFn: async (): Promise<SpaceDetailData> => {
      const supabase = createBrowserClient();
      const [space, links, tasks, docs, pins, subTeams] = await Promise.all([
        supabase
          .from("spaces")
          .select("id, name, description, color, icon, created_at")
          .eq("id", spaceId)
          .maybeSingle(),
        supabase.from("project_spaces").select("project_id").eq("space_id", spaceId),
        supabase
          .from("tasks")
          .select("id, title, status, list_id, status_id")
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
        supabase
          .from("spaces")
          .select("id, name, color, icon")
          .eq("parent_space_id", spaceId)
          .is("archived_at", null)
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
          if (isDone(t)) a.done += 1;
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
        subTeams: (subTeams.data ?? []) as SpaceDetailData["subTeams"],
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
  const meId = useViewerId();
  const activityLookup = useActivityLookup(propertyId, meId);
  useActivityLogRealtime(propertyId);
  // One feed for both the Overview rail (last 6) and the Activity tab.
  const { data: activity = [] } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "space", id: spaceId }),
  );
  const { data: allTasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { data: allDocs = [] } = useQuery(documentsQueryOptions(propertyId));
  const { data: people = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: memberIds = [] } = useQuery(spaceMemberIdsQueryOptions(spaceId));
  // Pending triage for THIS team — the "Go to → Triage" count.
  const { data: triageQueue = [] } = useQuery(
    triageQueueQueryOptions(propertyId),
  );
  const triageCount = triageQueue.filter((t) => t.space_id === spaceId).length;
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
    () => tasks.filter((t) => isDone(t)).length,
    [tasks],
  );

  const statusCatalog = useStatusCatalog(propertyId);
  const teamLists = useMemo(
    () =>
      statusCatalog
        .listsOfSpace(spaceId)
        .map((l) => ({ id: l.id, name: l.name })),
    [statusCatalog, spaceId],
  );

  const [name, setName] = useState("");
  const [activeTab, setActiveTab] = useUrlTab("overview");
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
    if (!window.confirm("Archive this team?")) return;
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
      <div className="page wide" aria-busy="true" aria-label="Loading team">
        <div className="ph">
          <span className="sk" style={{ width: 36, height: 36, borderRadius: 9 }} />
          <div className="col" style={{ gap: 8 }}>
            <span className="sk" style={{ width: 220, height: 20 }} />
            <span className="sk" style={{ width: 320, height: 11 }} />
          </div>
        </div>
        <span className="sk" style={{ width: "100%", height: 36, marginBottom: 16 }} />
        <div className="grid2">
          <span className="sk" style={{ height: 240, borderRadius: 10 }} />
          <span className="sk" style={{ height: 240, borderRadius: 10 }} />
        </div>
      </div>
    );
  if (!space)
    return (
      <div className="page">
        <G8Empty
          icon={Layers}
          title="Team not found"
          text="It may have been archived, or you no longer have access."
        >
          <Link href={`/p/${propertyId}/home`} className="btn btn-secondary btn-sm">
            Back home
          </Link>
        </G8Empty>
      </div>
    );

  const base = `/p/${propertyId}`;
  const crumbs = (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 text-sm"
    >
      <Link
        href={`${base}/members?tab=teams`}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        Teams
      </Link>
      <ChevronRight
        className="size-3.5 shrink-0 text-muted-foreground"
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

  // gr8r `pageTeam` `.ph`: big `.picon` (the colour picker when the team has
  // no emoji), the editable name as the h1, the description, then actions.
  const teamIcon = space.icon ? (
    <TeamIcon team={space} lg />
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" aria-label="Team color" title="Team color" />
        }
      >
        <TeamIcon team={space} lg />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6}>
        {COLORS.map((c) => (
          <DropdownMenuItem
            key={c}
            onClick={() => void recolor(c)}
            className="gap-2 capitalize"
          >
            <span className={cn("size-3 rounded-md", DOT[c])} />
            <span className="flex-1">{c}</span>
            {space.color === c ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const overflow = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className="ibtn" aria-label="More" title="More" />
        }
      >
        <Gi icon={MoreHorizontal} size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem
          onClick={() => {
            // Contextual workflow entry — seeds the AI builder with this
            // team so triggers/steps come back pre-scoped (same ?prefill=
            // channel the task menus use).
            const prefill = encodeURIComponent(
              btoa(
                JSON.stringify({
                  goal: `Build an automation for the ${space.name} team`,
                }),
              ),
            );
            router.push(`${base}/workflows/new?prefill=${prefill}`);
          }}
        >
          <Workflow className="size-3.5" />
          <span className="flex-1">Automate this team</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleArchive}>
          <Archive className="size-3.5" />
          <span className="flex-1">Archive team</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const header = (
    <TeamHeader
      icon={teamIcon}
      title={
        <h1 style={{ margin: 0 }}>
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
            aria-label="Team name"
            placeholder="Untitled team"
            style={{
              font: "inherit",
              color: "inherit",
              letterSpacing: "inherit",
              background: "transparent",
              border: 0,
              outline: "none",
              padding: 0,
              width: "100%",
            }}
          />
        </h1>
      }
      description={
        <WorkspaceDescription
          value={space.description}
          onSave={commitDescription}
        />
      }
      acts={
        <>
          <FavoriteStar
            propertyId={propertyId}
            kind="space"
            id={spaceId}
            label={space?.name}
            className="ibtn"
          />
          <Link
            href={`${base}/tasks/new?space=${spaceId}`}
            className="btn btn-secondary"
          >
            <Gi icon={Plus} size={14} />
            New task
          </Link>
          {overflow}
        </>
      }
      below={
        <>
          <div className="row faint" style={{ gap: 14, fontSize: 12.5, flexWrap: "wrap" }}>
            <Link href={`${base}/tasks?space=${spaceId}`} className="row" style={{ gap: 5 }}>
              <Gi icon={Layers} size={13} />
              {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            </Link>
            <span className="row" style={{ gap: 6 }} title={`${doneCount} of ${tasks.length} done`}>
              <span style={{ width: 80, display: "inline-flex" }}>
                <ProgBar value={pct} />
              </span>
              {pct}% done
            </span>
            <button type="button" className="row" style={{ gap: 5 }} onClick={() => setActiveTab("docs")}>
              <Gi icon={FileText} size={13} />
              {docs.length} {docs.length === 1 ? "doc" : "docs"}
            </button>
            {space.created_at ? (
              <span className="row" style={{ gap: 5 }}>
                <Gi icon={Calendar} size={13} />
                Created {new Date(space.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </span>
            ) : null}
          </div>
          <ScopeStatStrip
            propertyId={propertyId}
            scope={{ kind: "space", id: spaceId }}
          />
          <CatchUpBanner
            propertyId={propertyId}
            subjectKind="space"
            subjectId={spaceId}
          />
        </>
      }
    />
  );

  const subTeams = data?.subTeams ?? [];
  const tabs: TeamTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <TeamOverview
          propertyId={propertyId}
          spaceId={spaceId}
          projects={data?.projects ?? []}
          roster={roster}
          subTeams={subTeams}
          triageCount={triageCount}
          taskCount={tasks.length}
          activity={activity}
          activityLookup={activityLookup}
          onSeeActivity={() => setActiveTab("activity")}
          onSeeMembers={() => setActiveTab("members")}
          extra={
            <div className="stack">
              <TeamScoreboard propertyId={propertyId} spaceId={spaceId} />
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
            </div>
          }
        />
      ),
    },
    {
      id: "daily-ops",
      label: "Daily ops",
      content: <DailyOpsPanel propertyId={propertyId} spaceId={spaceId} />,
    },
    {
      id: "automations",
      label: "Automations",
      content: (
        <SpaceAutomationsPanel
          propertyId={propertyId}
          spaceId={spaceId}
          spaceName={space.name}
        />
      ),
    },
    {
      id: "activity",
      label: "Activity",
      content: (
        <TeamActivityFeed
          rows={activity}
          lookup={activityLookup}
          meId={meId}
        />
      ),
    },
    {
      // Historical id (kept stable for saved tab state) — the label follows
      // the product vocabulary: this is the team's task list.
      id: "issues",
      label: "Tasks",
      count: tasks.length,
      content: (
        <TasksPanel
          propertyId={propertyId}
          tasks={tasks}
          candidates={taskCandidates}
          onAdd={add(setTaskSpace)}
          onRemove={remove(setTaskSpace)}
          lists={teamLists}
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
      count: roster.length,
      content: <SpaceMembersPanel propertyId={propertyId} spaceId={spaceId} />,
    },
    {
      id: "channels",
      label: "Channels",
      content: <SpaceChannelsPanel propertyId={propertyId} spaceId={spaceId} />,
    },
  ];

  return (
    <TeamPageShell
      crumbs={crumbs}
      header={header}
      tabs={tabs}
      active={activeTab}
      onTab={setActiveTab}
    />
  );
}

/* ── Activity tab — gr8r `pageActivity` scoped to the team ─────────────────── */

const FAMILIES: { id: ActivityFamily; label: string }[] = [
  { id: "all", label: "All" },
  { id: "status", label: "Status changes" },
  { id: "assignments", label: "Assignments" },
  { id: "dates", label: "Dates" },
  { id: "created", label: "Created" },
  { id: "projects", label: "Projects" },
];

/** Kind `.seg` + person `.select`, then `.day-h` buckets of `.feed.lined`
 *  rows — the same families + person filter `ActivityLogFeed` offered. */
function TeamActivityFeed({
  rows,
  lookup,
  meId,
}: {
  rows: Parameters<typeof groupActivityByDay>[0];
  lookup: ActivityLookup;
  meId: string | null | undefined;
}) {
  const [family, setFamily] = useState<ActivityFamily>("all");
  const [who, setWho] = useState("all");
  const people = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) if (r.actor_id) ids.add(r.actor_id);
    return [...ids]
      .map((id) => lookup.members.get(id))
      .filter((m): m is PropertyMember => Boolean(m))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [rows, lookup.members]);
  const visible = useMemo(
    () => rows.filter((r) => matchesFamily(r, family) && (who === "all" || r.actor_id === who)),
    [rows, family, who],
  );
  const groups = useMemo(() => groupActivityByDay(visible), [visible]);

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <div className="seg" role="group" aria-label="Filter by kind" style={{ flexWrap: "wrap" }}>
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              className={family === f.id ? "on" : ""}
              aria-pressed={family === f.id}
              onClick={() => setFamily(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {people.length ? (
          <select
            className="select"
            style={{ height: 26, width: "auto", fontSize: 12 }}
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label="Filter by person"
          >
            <option value="all">Everyone</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === meId ? `${m.name ?? "You"} (you)` : (m.name ?? m.email ?? "Member")}
              </option>
            ))}
          </select>
        ) : null}
        <span className="sp" />
        <span className="faint" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {visible.length === rows.length
            ? `${rows.length} ${rows.length === 1 ? "change" : "changes"}`
            : `${visible.length} of ${rows.length}`}
        </span>
      </div>
      {groups.length === 0 ? (
        <G8Empty
          icon={Activity}
          title={rows.length === 0 ? "No activity yet" : "Nothing matches these filters"}
          text={
            rows.length === 0
              ? "Changes to this team's tasks and projects will appear here, with who made them."
              : "Try a different kind or person."
          }
        />
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <div className="day-h">{g.label}</div>
            <div className="feed lined">
              {g.rows.map((r) => (
                <FeedItem key={r.id} row={r} lookup={lookup} showProject />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
