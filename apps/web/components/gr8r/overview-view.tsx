"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChartGantt,
  ChartLine,
  FolderKanban,
  LayoutDashboard,
  Plus,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { StIcon } from "@/components/gr8r/home-glyphs";
import {
  cVar,
  dayDiff,
  g8Color,
  relDate,
  startOfDay,
} from "@/components/gr8r/my-tasks-glyphs";
import {
  OvAv,
  OvPIcon,
  OvPStatus,
  OvProg,
  fmtShortDate,
  projectStatusOf,
  type OvMember,
} from "@/components/gr8r/overview-glyphs";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import { progressPct } from "@/components/projects/tracking/tracking-shared";
import {
  describeActivity,
  useActivityLogRealtime,
  useActivityLookup,
  useViewerId,
} from "@/components/activity/activity-log";
import {
  propertyMembersQueryOptions,
  tasksQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";
import { projectsTrackingQueryOptions } from "@/lib/query/project-queries";
import { propertyMilestonesQueryOptions } from "@/lib/query/milestone-queries";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import { insightsMetricsQueryOptions } from "@/lib/query/insights-queries";
import { useOpenProject } from "@/lib/projects/use-open-project";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { canManage, isFullMember } from "@/lib/auth/roles";
import type { Role } from "@/lib/db/types";
import {
  isBlocked,
  isDone,
  isNotStarted,
  isStarted,
  type StatusLike,
} from "@/lib/tasks/statuses";
import type { Task } from "@/components/tasks/kanban";
import type { PaceFlag, PortfolioRow } from "@/lib/insights/metrics";

/**
 * gr8r-studio's `pageOverview` (src/pages/overview.js) over our data: the
 * 4-stat strip, then `.grid2` — Portfolio (+ recent activity) on the left;
 * Tasks by status, Workload and Upcoming milestones on the right.
 *
 * Numbers come from the deterministic insights layer where one exists
 * (`/insights/metrics` — the same functions the Insights dashboards chart):
 * the open-work snapshot (status buckets, overdue), the portfolio's per-
 * project overdue + pace, and the workload matrix. That payload is role-
 * shaped — staff get their personal slice, not peer comparison — so for them
 * the page falls back to the shared task cache and hides Workload.
 */

const EMPTY_TASKS: Task[] = [];
const IN_OVERVIEW = /^\/p\/[^/]+\/overview\/?$/;

/** Route entry: renders only while the surface pathname is `/overview`. */
export function OverviewPage({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();
  if (!IN_OVERVIEW.test(pathname)) return null;
  return <OverviewView propertyId={propertyId} />;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function ago(iso: string, now: number): string {
  const m = Math.round((now - new Date(iso).getTime()) / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtShortDate(iso);
}

type Bucket = {
  key: "todo" | "in_progress" | "blocked" | "done";
  name: string;
  color: string;
  glyph: StatusLike;
  n: number;
};

export function OverviewView({ propertyId }: { propertyId: string }) {
  const now = useNow();
  const today = startOfDay(now);
  const base = `/p/${propertyId}`;
  const openProject = useOpenProject(propertyId);
  const viewerId = useViewerId();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: tasks = EMPTY_TASKS } = useQuery(tasksQueryOptions(propertyId));
  const { data: projects = [], isPending: projectsPending } = useQuery(
    projectsTrackingQueryOptions(propertyId),
  );
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: milestones = [] } = useQuery(
    propertyMilestonesQueryOptions(propertyId),
  );
  const myRole = (members.find((m) => m.id === viewerId)?.role ?? null) as Role | null;
  const manager = canManage(myRole);

  // Role-shaped: management gets the full set; staff get `myWeek` (no peers).
  const { data: metricsRes } = useQuery({
    ...insightsMetricsQueryOptions(propertyId),
    enabled: manager,
  });
  const metrics = metricsRes && metricsRes.role !== "staff" ? metricsRes : null;

  const { data: invites } = useQuery({
    queryKey: ["property-invites", propertyId],
    enabled: manager,
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/invites`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("Failed to load invites");
      return (await r.json()) as { pending: unknown[] };
    },
  });

  const memberById = useMemo(
    () => new Map<string, PropertyMember>(members.map((m) => [m.id, m])),
    [members],
  );
  const toAv = (id: string | null | undefined): OvMember | null => {
    if (!id) return null;
    const m = memberById.get(id);
    return m ? { id: m.id, name: m.name, avatarUrl: m.avatarUrl } : null;
  };

  /* ── Tasks by status: open buckets from the metrics snapshot, done from the cache ── */
  const buckets = useMemo<Bucket[]>(() => {
    const snap = metrics?.snapshot.byStatus;
    const fromSnap = (k: "todo" | "in_progress" | "blocked") =>
      snap?.find((b) => b.status === k)?.count;
    const open = tasks.filter((t) => !isDone(t));
    return [
      {
        key: "todo",
        name: "To do",
        color: "var(--g8-st-todo)",
        glyph: { status: "todo" },
        n: fromSnap("todo") ?? open.filter((t) => isNotStarted(t)).length,
      },
      {
        key: "in_progress",
        name: "In progress",
        color: "var(--g8-st-progress)",
        glyph: { status: "in_progress" },
        n:
          fromSnap("in_progress") ??
          open.filter((t) => isStarted(t) && !isBlocked(t)).length,
      },
      {
        key: "blocked",
        name: "Blocked",
        color: "var(--g8-red)",
        glyph: { status: "blocked", status_category: "active", status_blocked: true },
        n: fromSnap("blocked") ?? open.filter((t) => isBlocked(t)).length,
      },
      {
        key: "done",
        name: "Done",
        color: "var(--g8-st-done)",
        glyph: { status: "done" },
        n: tasks.filter((t) => isDone(t)).length,
      },
    ];
  }, [tasks, metrics]);
  const done = buckets[3]!.n;
  const openTotal = buckets.slice(0, 3).reduce((a, b) => a + b.n, 0);
  const total = openTotal + done;
  const overdueTotal =
    metrics?.snapshot.overdueTotal ??
    tasks.filter((t) => !isDone(t) && t.due_at && dayDiff(t.due_at, today) < 0)
      .length;

  /* ── Portfolio ── */
  const portfolioById = useMemo(
    () =>
      new Map<string, PortfolioRow>(
        (metrics?.portfolio ?? []).map((r) => [r.projectId, r]),
      ),
    [metrics],
  );
  const clientOverdue = (() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (!t.project_id || isDone(t) || !t.due_at) continue;
      if (dayDiff(t.due_at, today) < 0)
        m.set(t.project_id, (m.get(t.project_id) ?? 0) + 1);
    }
    return m;
  })();

  /* ── Workload (management only — the metrics matrix) ── */
  const load = useMemo(() => {
    if (!metrics) return [];
    const rows = new Map(metrics.workload.map((w) => [w.userId, w]));
    const out = metrics.workload.map((w) => ({
      id: w.userId,
      name: memberById.get(w.userId)?.name ?? w.name,
      avatarUrl: memberById.get(w.userId)?.avatarUrl ?? w.avatarUrl,
      open: w.open,
      blocked: w.blocked,
      overdue: w.overdue,
    }));
    for (const m of members) {
      if (rows.has(m.id) || !isFullMember(m.role as Role)) continue;
      out.push({
        id: m.id,
        name: m.name ?? "Member",
        avatarUrl: m.avatarUrl,
        open: 0,
        blocked: 0,
        overdue: 0,
      });
    }
    return out.sort((a, b) => b.open - a.open);
  }, [metrics, members, memberById]);
  const maxL = Math.max(...load.map((l) => l.open), 1);

  /* ── Upcoming milestones ── */
  const upcoming = milestones
        .filter(
          (m) =>
            !m.completed_at &&
            dayDiff(`${m.due_date}T00:00:00`, today) >= 0,
        )
        .slice(0, 6);

  /* ── Recent activity ── */
  const lookup = useActivityLookup(propertyId, viewerId);
  useActivityLogRealtime(propertyId);
  const { data: activity = [], isPending: activityPending } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "property" }, 8),
  );

  const pendingInvites = invites?.pending.length ?? 0;
  const guests = members.filter((m) => m.role === "guest").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Overview" icon={<LayoutDashboard />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page">
          <div className="ph">
            <div>
              <h1>Workspace overview</h1>
              <p>Health of every project in this workspace.</p>
            </div>
            <div className="acts">
              {manager ? (
                <Link href={`${base}/home/insights`} className="btn btn-ghost">
                  <Gi icon={ChartLine} size={14} />
                  Insights
                </Link>
              ) : null}
              <Link href={`${base}/timeline`} className="btn btn-secondary">
                <Gi icon={ChartGantt} size={14} />
                Timeline
              </Link>
              {isFullMember(myRole) ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCreateOpen(true)}
                >
                  <Gi icon={Plus} size={14} />
                  New project
                </button>
              ) : null}
            </div>
          </div>

          <div className="stats" style={{ marginBottom: 16 }}>
            <Link href={`${base}/projects`} className="stat" style={{ color: "inherit" }}>
              <span className="k">Projects</span>
              <span className="v">{projects.length}</span>
              <span className="d">
                {projects.filter((p) => p.status === "completed").length} completed
              </span>
            </Link>
            <Link href={`${base}/tasks`} className="stat" style={{ color: "inherit" }}>
              <span className="k">Tasks</span>
              <span className="v">{total}</span>
              <span className={overdueTotal ? "d bad" : "d"}>
                {openTotal} open
                {overdueTotal ? ` · ${overdueTotal} overdue` : ""}
              </span>
            </Link>
            <div className="stat">
              <span className="k">Completion rate</span>
              <span className="v">{Math.round((done / Math.max(total, 1)) * 100)}%</span>
              <span className="d">across all projects</span>
            </div>
            <div className="stat">
              <span className="k">Members</span>
              <span className="v">{members.length - guests}</span>
              <span className="d">
                {manager
                  ? `${pendingInvites} pending invite${pendingInvites === 1 ? "" : "s"}`
                  : guests
                    ? `+ ${guests} guest${guests === 1 ? "" : "s"}`
                    : "in this workspace"}
              </span>
            </div>
          </div>

          <div className="grid2">
            <div className="stack">
              <section className="panel">
                <div className="panel-h">
                  <h2>Portfolio</h2>
                  <div className="acts">
                    <Link href={`${base}/projects`} className="btn btn-sm btn-ghost">
                      All projects
                    </Link>
                  </div>
                </div>
                {projects.length ? (
                  <div style={{ overflowX: "auto" }}>
                    <table className="perm-t" style={{ minWidth: 600 }}>
                      <thead>
                        <tr>
                          <th style={{ paddingLeft: 14 }}>Project</th>
                          <th style={{ textAlign: "left" }}>Lead</th>
                          <th style={{ textAlign: "left" }}>Status</th>
                          <th style={{ textAlign: "left", width: "22%" }}>Progress</th>
                          <th>Open</th>
                          <th>Overdue</th>
                          <th style={{ textAlign: "left" }}>Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map((p) => {
                          const row = portfolioById.get(p.id);
                          const pace: PaceFlag | null = row?.pace ?? null;
                          const st = projectStatusOf(p, pace, now);
                          const pr = progressPct(p.done, p.total);
                          const ov = row?.overdue ?? clientOverdue.get(p.id) ?? 0;
                          const lead = toAv(p.lead_user_id);
                          return (
                            <tr
                              key={p.id}
                              style={{ cursor: "pointer" }}
                              tabIndex={0}
                              onClick={() => openProject(p.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") openProject(p.id);
                              }}
                            >
                              <td style={{ paddingLeft: 14 }}>
                                <span className="row">
                                  <OvPIcon color={p.color} icon={p.icon} />
                                  <span className="trunc" style={{ fontWeight: 500 }}>
                                    {p.name}
                                  </span>
                                </span>
                              </td>
                              <td style={{ textAlign: "left" }}>
                                {lead ? (
                                  <span className="row">
                                    <OvAv member={lead} />
                                    <span className="muted trunc">
                                      {(lead.name ?? "").split(" ")[0]}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="faint">—</span>
                                )}
                              </td>
                              <td style={{ textAlign: "left" }}>
                                <OvPStatus
                                  name={st.name}
                                  color={st.c}
                                  tip={row?.paceReasons.join(" · ") || undefined}
                                />
                              </td>
                              <td>
                                <span className="row">
                                  <OvProg value={pr} tone={st.tone} />
                                  <span
                                    className="num faint"
                                    style={{ fontSize: 11.5, width: 30 }}
                                  >
                                    {pr}%
                                  </span>
                                </span>
                              </td>
                              <td className="num">{p.total - p.done}</td>
                              <td
                                className="num"
                                style={{
                                  color: ov ? "var(--g8-red)" : "var(--g8-text-3)",
                                }}
                              >
                                {ov}
                              </td>
                              <td style={{ textAlign: "left" }} className="num muted">
                                {fmtShortDate(p.target_date)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state sm">
                    <div className="glyph">
                      <Gi icon={FolderKanban} size={20} />
                    </div>
                    <h3 className="es-h">
                      {projectsPending ? "Loading projects…" : "No projects yet"}
                    </h3>
                    <p>Projects you start will show their health here.</p>
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="panel-h">
                  <h2>Recent activity</h2>
                  <div className="acts">
                    <Link
                      href={`${base}/activity?view=workspace`}
                      className="btn btn-sm btn-ghost"
                    >
                      View all
                    </Link>
                  </div>
                </div>
                <div className="panel-b feed lined">
                  {activity.length === 0 ? (
                    <div className="faint" style={{ fontSize: 12.5, padding: "4px 0" }}>
                      {activityPending
                        ? "Loading activity…"
                        : "Nothing has changed yet — task and project updates will show here."}
                    </div>
                  ) : (
                    activity.map((row) => {
                      const desc = describeActivity(row, lookup);
                      const Glyph = row.actor_kind === "workflow" ? Zap : Bot;
                      return (
                        <div key={row.id} className="fitem">
                          {desc.actorMember ? (
                            <OvAv
                              member={{
                                id: desc.actorMember.id,
                                name: desc.actorMember.name,
                                avatarUrl: desc.actorMember.avatarUrl,
                              }}
                            />
                          ) : (
                            <span
                              className="av sm"
                              style={cVar("var(--g8-gray)")}
                              aria-hidden="true"
                            >
                              <Gi icon={Glyph} size={11} />
                            </span>
                          )}
                          <div className="grow">
                            <b>{desc.actor}</b>{" "}
                            <span className="muted">{desc.verb}</span>{" "}
                            {desc.object ? (
                              desc.object.href ? (
                                <Link
                                  href={desc.object.href}
                                  className="obj"
                                  style={{ color: "inherit" }}
                                >
                                  {desc.object.label}
                                </Link>
                              ) : (
                                <span className="obj">{desc.object.label}</span>
                              )
                            ) : null}{" "}
                            {desc.extra ? (
                              <span className="muted">{desc.extra}</span>
                            ) : null}
                            {desc.project && row.entity_kind !== "project" ? (
                              <span className="faint"> in {desc.project.name}</span>
                            ) : null}
                          </div>
                          <time
                            dateTime={row.created_at}
                            title={new Date(row.created_at).toLocaleString()}
                          >
                            {ago(row.created_at, now)}
                          </time>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </div>

            <div className="stack">
              <section className="panel">
                <div className="panel-h">
                  <h2>Tasks by status</h2>
                </div>
                <div className="panel-b">
                  <div className="stackbar" style={{ height: 10, marginBottom: 12 }}>
                    {buckets.map((c) => (
                      <i
                        key={c.key}
                        style={{
                          width: `${(c.n / Math.max(total, 1)) * 100}%`,
                          background: c.color,
                        }}
                        title={`${c.name}: ${c.n}`}
                      />
                    ))}
                  </div>
                  {buckets.map((c) => (
                    <div
                      key={c.key}
                      className="row"
                      style={{ height: 28, fontSize: 13 }}
                    >
                      <StIcon task={c.glyph} />
                      <span className="grow">{c.name}</span>
                      <span className="num muted">{c.n}</span>
                      <span
                        className="num faint"
                        style={{ width: 36, textAlign: "right" }}
                      >
                        {Math.round((c.n / Math.max(total, 1)) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {manager ? (
                <section className="panel">
                  <div className="panel-h">
                    <h2>Workload</h2>
                    <div className="acts">
                      <span className="faint" style={{ fontSize: 11.5 }}>
                        Open tasks per person
                      </span>
                    </div>
                  </div>
                  <div className="panel-b">
                    {load.length ? (
                      load.map((l) => (
                        <div
                          key={l.id}
                          className="row"
                          style={{ height: 30, fontSize: 13 }}
                          title={`${l.open} open · ${l.blocked} blocked · ${l.overdue} overdue`}
                        >
                          <OvAv
                            member={{ id: l.id, name: l.name, avatarUrl: l.avatarUrl }}
                          />
                          <span style={{ width: 96 }} className="trunc">
                            {(l.name ?? "").split(" ")[0]}
                          </span>
                          <span
                            className="grow"
                            style={{
                              display: "flex",
                              height: 8,
                              borderRadius: 4,
                              overflow: "hidden",
                              background: "var(--g8-surface-3)",
                            }}
                          >
                            <span
                              style={{ display: "flex", width: `${(l.open / maxL) * 100}%` }}
                            >
                              {l.blocked ? (
                                <i
                                  style={{
                                    display: "block",
                                    flex: l.blocked,
                                    background: "var(--g8-red)",
                                  }}
                                />
                              ) : null}
                              {l.open - l.blocked > 0 ? (
                                <i
                                  style={{
                                    display: "block",
                                    flex: l.open - l.blocked,
                                    background: "var(--g8-st-progress)",
                                  }}
                                />
                              ) : null}
                            </span>
                          </span>
                          <span
                            className="num muted"
                            style={{ width: 22, textAlign: "right" }}
                          >
                            {l.open}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="faint">
                        {metricsRes ? "No open work assigned" : "Loading…"}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              <section className="panel">
                <div className="panel-h">
                  <h2>Upcoming milestones</h2>
                </div>
                <div className="panel-b">
                  {upcoming.length ? (
                    upcoming.map((m) => (
                      <div
                        key={m.id}
                        className="row"
                        role="button"
                        tabIndex={0}
                        style={{ height: 32, fontSize: 13, cursor: "pointer" }}
                        onClick={() => openProject(m.project_id, "timeline")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") openProject(m.project_id, "timeline");
                        }}
                      >
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            transform: "rotate(45deg)",
                            background: g8Color(m.project?.color),
                            borderRadius: 2,
                            flexShrink: 0,
                            margin: "0 3px",
                          }}
                        />
                        <span className="grow trunc">
                          {m.name}{" "}
                          {m.project ? (
                            <span className="faint">· {m.project.name}</span>
                          ) : null}
                        </span>
                        <span className="num muted">
                          {relDate(`${m.due_date}T00:00:00`, today)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="faint">No upcoming milestones</div>
                  )}
                </div>
              </section>
            </div>
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
