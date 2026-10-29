"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, FileText, Hash, MessageCircle, Sheet, Star } from "lucide-react";
import type { Channel } from "stream-chat";
import { Gi } from "@/components/gr8r/icon";
import { PageHeader } from "@/components/shell/page-header";
import { AssigneeStack } from "@/components/tasks/assignee-stack";
import { toggleTaskFavorite } from "@/components/tasks/task-detail-actions";
import { updateTask } from "@/components/tasks/actions";
import type { Task } from "@/components/tasks/kanban";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  documentsTreeQueryOptions,
  formsListQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  projectsTrackingQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { useTaskStatusOptions } from "@/lib/query/status-queries";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { useConnectedStreamClient } from "@/lib/stream/client-provider";
import { useOpenSpace } from "@/lib/spaces/use-open-space";
import { useFavorites } from "@/lib/favorites/use-favorites";
import { FavoriteStar } from "./favorite-star";
import { ProjectCard, useProjectCardCtx } from "./projects-view";
import { TeamIcon } from "./teams-grid";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { taskAssigneeIds } from "@/lib/tasks/assignees";
import { useAssigneesMap } from "@/lib/tasks/use-assignees";
import { describeStatus, isDone } from "@/lib/tasks/statuses";
import type { EntityColor } from "@/lib/db/types";
import {
  G8PriorityIcon,
  G8StatusIcon,
  PRIORITY_NAME,
  cVar,
  dayDiff,
  g8Color,
  relDate,
  startOfDay,
} from "./my-tasks-glyphs";

/**
 * Favorites — gr8r-studio's `pageFavorites` (src/pages/favorites.js):
 * `.page.wide` › `.ph`, then Projects as gr8r's `.pgrid` of project cards and
 * Tasks as `.mini` rows — exactly gr8r — followed by what only this app can
 * star: Docs, Teams, Forms and Channels (one `h2.sec` + `.panel` each, shown
 * only when non-empty), or a single gr8r empty state. Tasks come from
 * `task_favorites` (the task star); everything else from `favorites` (0120,
 * the `FavoriteStar` on each surface's header). Both are server-side and
 * per user, and both are live.
 */

/** The caller's starred task ids, newest first. RLS keeps it to `auth.uid()`. */
function favoriteTasksQueryOptions(propertyId: string) {
  return {
    queryKey: ["task-favorites", propertyId] as const,
    staleTime: 0,
    queryFn: async (): Promise<string[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("task_favorites")
        .select("task_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.task_id);
    },
  };
}

const EMPTY_TASKS: Task[] = [];

/**
 * Live `task_favorites` for the signed-in user: a star toggled on task detail
 * (any tab) refetches the list. Filtered to `user_id` server-side; RLS also
 * fences it. The user id is read from the browser session so the route needs
 * no server lookup.
 */
function useTaskFavoritesRealtime(propertyId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const supabase = createBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`task-favorites:${uid}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "task_favorites", filter: `user_id=eq.${uid}` },
          () => void qc.invalidateQueries({ queryKey: ["task-favorites", propertyId] }),
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [qc, propertyId]);
}

const IN_FAVORITES = /^\/p\/[^/]+\/favorites\/?$/;

/** Route entry: renders only while the surface pathname is `/favorites`. */
export function FavoritesPage({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();
  if (!IN_FAVORITES.test(pathname)) return null;
  return <FavoritesView propertyId={propertyId} />;
}

export function FavoritesView({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const openDocument = useOpenDocument(propertyId);
  const openSpace = useOpenSpace(propertyId);
  const openChannel = useOpenChannel(propertyId);
  const fav = useFavorites(propertyId, { realtime: true });
  useTaskFavoritesRealtime(propertyId);
  const { data: tasks = EMPTY_TASKS } = useQuery(tasksQueryOptions(propertyId));
  const { data: favIds = [], isPending } = useQuery(
    favoriteTasksQueryOptions(propertyId),
  );
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const projectColor = useMemo(
    () => new Map(projects.map((p) => [p.id, p.color as EntityColor])),
    [projects],
  );
  const [today] = useState(() => startOfDay(new Date()));

  const projectIds = fav.idsOf("project");
  const docIds = fav.idsOf("document");
  const spaceIds = fav.idsOf("space");
  const formIds = fav.idsOf("form");
  const channelIds = fav.idsOf("channel");

  // Each source loads only when something of its kind is starred.
  const { data: tracking = [] } = useQuery({
    ...projectsTrackingQueryOptions(propertyId),
    enabled: projectIds.length > 0,
  });
  const { data: docs = [] } = useQuery({
    ...documentsTreeQueryOptions(propertyId),
    enabled: docIds.length > 0,
  });
  const { data: spaces = [] } = useQuery({
    ...spacesQueryOptions(propertyId),
    enabled: spaceIds.length > 0,
  });
  const { data: forms = [] } = useQuery({
    ...formsListQueryOptions(propertyId),
    enabled: formIds.length > 0,
  });
  const channels = useFavoriteChannels(channelIds);
  const cardCtx = useProjectCardCtx(propertyId);

  /** Starred ids → rows, in star order, dropping anything gone or unseen. */
  function pick<T extends { id: string }>(ids: string[], rows: T[]): T[] {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is T => !!r);
  }
  const favProjects = pick(projectIds, tracking);
  const favDocs = pick(docIds, docs);
  const favSpaces = pick(spaceIds, spaces);
  const favForms = pick(formIds, forms);
  const favChannels = pick(
    channelIds,
    channels.map((c) => ({ id: c.id ?? "", channel: c })),
  );

  // Favorites span properties; only this property's tasks are in the cache.
  const favTasks = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return favIds.map((id) => byId.get(id)).filter((t): t is Task => !!t);
  }, [favIds, tasks]);

  const openByTeam = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (t.space_id && !isDone(t)) m.set(t.space_id, (m.get(t.space_id) ?? 0) + 1);
    return m;
  }, [tasks]);

  const assigneeIds = useMemo(() => favTasks.flatMap(taskAssigneeIds), [favTasks]);
  const assignees = useAssigneesMap(assigneeIds);

  async function unstarTask(taskId: string) {
    const key = ["task-favorites", propertyId];
    const prev = qc.getQueryData<string[]>(key);
    if (prev) qc.setQueryData(key, prev.filter((id) => id !== taskId));
    const res = await toggleTaskFavorite(taskId);
    if ("error" in res) {
      if (prev) qc.setQueryData(key, prev);
      toast.error(res.error);
    }
    void qc.invalidateQueries({ queryKey: key });
  }

  const empty = !isPending && !fav.isPending && fav.rows.length === 0 && favIds.length === 0;
  const star = (kind: Parameters<typeof fav.toggle>[0], id: string) => (
    <FavoriteStar propertyId={propertyId} kind={kind} id={id} size={14} />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Favorites" icon={<Star />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          <div className="ph">
            <div>
              <h1>Favorites</h1>
              <p>Projects, tasks, docs and everything else you&apos;ve starred for quick access.</p>
            </div>
          </div>
          {empty ? (
            <div className="panel">
              <div className="empty-state">
                <div className="glyph">
                  <Gi icon={Star} size={20} />
                </div>
                <h2 className="es-h">No favorites yet</h2>
                <p>Star a project, task, doc, team, form or channel to pin it here.</p>
                <Link className="btn btn-secondary btn-sm" href={`/p/${propertyId}/projects`}>
                  Browse projects
                </Link>
              </div>
            </div>
          ) : (
            <>
              <Sec title="Projects" n={favProjects.length} mb={10} />
              {favProjects.length ? (
                <div className="pgrid" style={{ marginBottom: 28 }}>
                  {favProjects.map((p) => (
                    <ProjectCard key={p.id} p={p} ctx={cardCtx} />
                  ))}
                </div>
              ) : (
                <p className="faint" style={{ marginBottom: 28 }}>
                  No favorite projects.
                </p>
              )}

              <Sec title="Tasks" n={favTasks.length} />
              {favTasks.length ? (
                <div className="panel" style={{ overflow: "hidden", marginBottom: 28 }}>
                  {favTasks.map((t) => (
                    <FavoriteTaskRow
                      key={t.id}
                      task={t}
                      propertyId={propertyId}
                      today={today}
                      projectColor={projectColor}
                      assignees={assignees}
                      onUnstar={() => void unstarTask(t.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="faint" style={{ marginBottom: 28 }}>
                  Open a task and click the star to add it here.
                </p>
              )}

              {favDocs.length ? (
                <>
                  <Sec title="Docs" n={favDocs.length} />
                  <div className="panel" style={{ overflow: "hidden", marginBottom: 28 }}>
                    {favDocs.map((d) => (
                      <FavRow key={d.id} onOpen={() => openDocument(d.id)}>
                        <span className="faint" style={{ display: "inline-flex" }}>
                          <Gi icon={d.kind === "sheet" ? Sheet : FileText} size={14} />
                        </span>
                        <span className="tt">{d.title || "Untitled"}</span>
                        <span className="due hide-m">Edited {relDate(d.updated_at, today)}</span>
                        {star("document", d.id)}
                      </FavRow>
                    ))}
                  </div>
                </>
              ) : null}

              {favSpaces.length ? (
                <>
                  <Sec title="Teams" n={favSpaces.length} />
                  <div className="panel" style={{ overflow: "hidden", marginBottom: 28 }}>
                    {favSpaces.map((sp) => (
                      <FavRow key={sp.id} onOpen={() => openSpace(sp.id)}>
                        <TeamIcon team={sp} />
                        <span className="tt">{sp.name}</span>
                        <span className="due hide-m">
                          {openByTeam.get(sp.id) ?? 0} open
                        </span>
                        {star("space", sp.id)}
                      </FavRow>
                    ))}
                  </div>
                </>
              ) : null}

              {favForms.length ? (
                <>
                  <Sec title="Forms" n={favForms.length} />
                  <div className="panel" style={{ overflow: "hidden", marginBottom: 28 }}>
                    {favForms.map((f) => (
                      <FavRow
                        key={f.id}
                        href={`/p/${propertyId}/forms/${f.id}`}
                      >
                        <span className="faint" style={{ display: "inline-flex" }}>
                          {f.icon ? (
                            <span style={{ width: 14, textAlign: "center", fontSize: 13 }}>{f.icon}</span>
                          ) : (
                            <Gi icon={ClipboardList} size={14} />
                          )}
                        </span>
                        <span className="tt">{f.title || "Untitled form"}</span>
                        <span className="due hide-m" style={{ textTransform: "capitalize" }}>
                          {f.status}
                        </span>
                        {star("form", f.id)}
                      </FavRow>
                    ))}
                  </div>
                </>
              ) : null}

              {favChannels.length ? (
                <>
                  <Sec title="Channels" n={favChannels.length} />
                  <div className="panel" style={{ overflow: "hidden", marginBottom: 28 }}>
                    {favChannels.map(({ id, channel }) => (
                      <FavRow key={id} onOpen={() => openChannel(channel.type, id)}>
                        <span className="faint" style={{ display: "inline-flex" }}>
                          <Gi icon={channel.type === "messaging" ? MessageCircle : Hash} size={14} />
                        </span>
                        <span className="tt">{channelName(channel)}</span>
                        {star("channel", id)}
                      </FavRow>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** gr8r `h2.sec` with its faint count. */
function Sec({ title, n, mb = 6 }: { title: string; n: number; mb?: number }) {
  return (
    <h2 className="sec" style={{ marginBottom: mb }}>
      {title}{" "}
      <span className="faint" style={{ fontWeight: 500 }}>
        {n}
      </span>
    </h2>
  );
}

/** A gr8r `.mini` row that opens its item (a Link when it has an href). */
function FavRow({
  onOpen,
  href,
  children,
}: {
  onOpen?: () => void;
  href?: string;
  children: React.ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className="mini">
        {children}
      </Link>
    );
  }
  return (
    <div
      className="mini"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onOpen?.();
      }}
    >
      {children}
    </div>
  );
}

/**
 * Starred channels, fetched from Stream by id. Uses the app's connected
 * client — this page sits outside Stream's `<Chat>` provider, where
 * `useChatContext()` has no client.
 */
function useFavoriteChannels(ids: string[]): Channel[] {
  const client = useConnectedStreamClient();
  const [channels, setChannels] = useState<Channel[]>([]);
  const key = ids.join(",");
  useEffect(() => {
    const want = key ? key.split(",") : [];
    if (!want.length || !client?.userID) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChannels([]);
      return;
    }
    let cancelled = false;
    client
      .queryChannels({ id: { $in: want } }, {}, { watch: false, state: true, limit: 30 })
      .then((rows) => {
        if (!cancelled) setChannels(rows);
      })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[favorites] channel lookup failed", err);
        }
        if (!cancelled) setChannels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, key]);
  return channels;
}

/** A channel's name; a DM reads as the other people in it. */
function channelName(c: Channel): string {
  const name = (c.data as { name?: string } | undefined)?.name;
  if (name) return name;
  const me = c.getClient().userID;
  const others = Object.values(c.state?.members ?? {})
    .map((m) => m.user)
    .filter((u) => u && u.id !== me)
    .map((u) => u?.name || u?.id);
  return others.length ? others.join(", ") : "Direct message";
}

function StarButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ibtn ibtn-sm"
      aria-label={label}
      title={label}
      style={{ color: "var(--g8-amber)" }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Star size={14} strokeWidth={1.8} fill="currentColor" className="i" aria-hidden="true" />
    </button>
  );
}

/** gr8r `miniRow`: complete-check, status glyph, title, project, priority, due, assignees. */
function FavoriteTaskRow({
  task: t,
  propertyId,
  today,
  projectColor,
  assignees,
  onUnstar,
}: {
  task: Task;
  propertyId: string;
  today: number;
  projectColor: Map<string, EntityColor>;
  assignees: ReturnType<typeof useAssigneesMap>;
  onUnstar: () => void;
}) {
  const qc = useQueryClient();
  const openTask = useOpenTask(propertyId);
  const options = useTaskStatusOptions(propertyId, t.list_id);
  const done = isDone(t);
  const shown = describeStatus(options, t.status_id ?? t.status, t);
  const n = t.due_at ? dayDiff(t.due_at, today) : null;
  const dueCls = done || n === null ? "" : n < 0 ? "over" : n <= 1 ? "soon" : "";

  async function toggleDone() {
    const target = done
      ? options.find((o) => o.category === "open") ?? options[0]
      : options.find((o) => o.category === "closed") ??
        options.find((o) => o.category === "done");
    if (!target) return;
    const res = await updateTask({ taskId: t.id, status: target.id });
    if ("error" in res) toast.error(res.error);
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }

  return (
    <div
      className={`mini ${done ? "done" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => openTask(t.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") openTask(t.id);
      }}
    >
      <input
        type="checkbox"
        className="check round"
        checked={done}
        onClick={(e) => e.stopPropagation()}
        onChange={() => void toggleDone()}
        aria-label={`Complete ${t.title}`}
      />
      <span title={shown.label} style={{ display: "inline-flex" }}>
        <G8StatusIcon category={shown.category} blocked={shown.isBlocked} color={shown.color} />
      </span>
      <span className="tt">{t.title}</span>
      {t.project_name ? (
        <span className="pj hide-m">
          <span
            className="pdot"
            style={cVar(g8Color(t.project_id ? projectColor.get(t.project_id) : null))}
          />
          <span className="trunc">{t.project_name}</span>
        </span>
      ) : null}
      <span title={`${PRIORITY_NAME[t.priority]} priority`} style={{ display: "inline-flex" }}>
        <G8PriorityIcon priority={t.priority} />
      </span>
      <span style={{ width: 74, textAlign: "right" }} className="hide-m">
        {t.due_at ? <span className={`due ${dueCls}`}>{relDate(t.due_at, today)}</span> : null}
      </span>
      <AssigneeStack ids={taskAssigneeIds(t)} infos={assignees} size={20} max={3} />
      <StarButton label={`Remove ${t.title} from favorites`} onClick={onUnstar} />
    </div>
  );
}
