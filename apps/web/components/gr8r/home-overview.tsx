"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Calendar,
  CircleCheck,
  CircleDashed,
  ClockAlert,
  FolderKanban,
  ListChecks,
  Zap,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  Av,
  AvStack,
  G8_COLOR,
  PR_NAME,
  PStatus,
  PrIcon,
  ProgBar,
  StIcon,
  priorityWeight,
  type AvMember,
} from "@/components/gr8r/home-glyphs";
import {
  propertyMembersQueryOptions,
  tasksQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  projectsTrackingQueryOptions,
  type ProjectTracking,
} from "@/lib/query/project-queries";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import {
  describeActivity,
  useActivityLogRealtime,
  useActivityLookup,
} from "@/components/activity/activity-log";
import {
  progressPct,
  projectHealth,
} from "@/components/projects/tracking/tracking-shared";
import { useOpenProject } from "@/lib/projects/use-open-project";
import { isDone } from "@/lib/tasks/statuses";
import { isAssignedTo, taskAssigneeIds } from "@/lib/tasks/assignees";
import { taskHref } from "@/lib/tasks/task-href";
import { updateTask } from "@/components/tasks/actions";
import type { Task } from "@/components/tasks/kanban";
import type { EntityColor } from "@/lib/db/types";
import {
  applyTaskFilter,
  useDashboardFilter,
} from "@/components/home/dashboard-filter";

/**
 * gr8r-studio's `pageHome` (src/pages/home.js) over our data: the 4-stat
 * strip, then `.grid2` — My tasks + Project progress on the left, Upcoming
 * deadlines + Recent activity on the right. The `.ph` page head (greeting,
 * date, actions) is rendered by the caller so it can carry Home's own extras.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/** Whole local days from today to `iso` (negative = past). */
function dayDiff(iso: string, today: number): number {
  return Math.round((startOfDay(new Date(iso)) - today) / DAY);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** gr8r `relDate`: Today / Tomorrow / Yesterday / weekday / `MMM d`. */
function relDate(iso: string, today: number): string {
  const n = dayDiff(iso, today);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 1 && n < 7) return WEEKDAYS[new Date(iso).getDay()]!;
  return fmtDate(iso);
}

/** gr8r `ago`: just now / 5m ago / 3h ago / 2d ago / `MMM d`. */
function ago(iso: string, now: number): string {
  const m = Math.round((now - new Date(iso).getTime()) / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(iso);
}

function isOverdue(t: Task, today: number): boolean {
  return !isDone(t) && !!t.due_at && dayDiff(t.due_at, today) < 0;
}

/** The clock, re-read once a minute so "today" and "ago" stay honest. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * gr8r's `countUp()`: a headline number counts up from 0 once, the first
 * time real data arrives (ease-out cubic, 520ms, skipped under reduced
 * motion and for values < 2).
 */
function CountUp({ value, ready }: { value: number; ready: boolean }) {
  const played = useRef(false);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!ready || played.current) return;
    played.current = true;
    if (
      value < 2 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let finished = false;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const k = Math.min(1, (now - t0) / 520);
      const e = 1 - Math.pow(1 - k, 3);
      if (k < 1) {
        setShown(Math.round(value * e));
        raf = requestAnimationFrame(step);
      } else {
        finished = true;
        setShown(null);
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      // React's dev double-invoke cancels the first run — let the second play.
      if (!finished) {
        played.current = false;
        setShown(null);
      }
    };
  }, [ready, value]);
  return <>{shown ?? value}</>;
}

type HomeTab = "upcoming" | "overdue" | "completed";

export function HomeOverview({
  propertyId,
  userId,
}: {
  propertyId: string;
  /** Whose "My tasks" this is — the viewer, or the person being viewed as. */
  userId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const openProject = useOpenProject(propertyId);
  const now = useNow();
  const today = startOfDay(new Date(now));
  const filter = useDashboardFilter();
  const base = `/p/${propertyId}`;

  const { data: allTasks = [], isSuccess: tasksReady } = useQuery(
    tasksQueryOptions(propertyId),
  );
  const { data: tracking = [], isSuccess: projectsReady } = useQuery(
    projectsTrackingQueryOptions(propertyId),
  );
  const { data: projectRows = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  const memberById = useMemo(
    () => new Map<string, PropertyMember>(members.map((m) => [m.id, m])),
    [members],
  );
  const projectById = useMemo(
    () => new Map(projectRows.map((p) => [p.id, p])),
    [projectRows],
  );
  const toAv = (id: string | null | undefined): AvMember | null => {
    if (!id) return null;
    const m = memberById.get(id);
    return m ? { id: m.id, name: m.name, avatarUrl: m.avatarUrl } : null;
  };

  // Top-level work only, narrowed by the Home scope filter.
  const tasks = useMemo(
    () => applyTaskFilter(allTasks, filter),
    [allTasks, filter],
  );
  const open = useMemo(() => tasks.filter((t) => !isDone(t)), [tasks]);
  const mine = useMemo(
    () => tasks.filter((t) => isAssignedTo(t, userId)),
    [tasks, userId],
  );
  const over = useMemo(
    () => tasks.filter((t) => isOverdue(t, today)),
    [tasks, today],
  );
  const doneWk = useMemo(
    () =>
      tasks.filter((t) => {
        if (!isDone(t)) return false;
        const at = t.completed_at ?? t.updated_at;
        return !!at && now - new Date(at).getTime() < 7 * DAY;
      }),
    [tasks, now],
  );

  const activeProjects = useMemo(() => {
    const scoped =
      filter.kind === "project"
        ? tracking.filter((p) => p.id === filter.id)
        : tracking;
    return scoped.filter(
      (p) => p.status !== "completed" && p.status !== "archived",
    );
  }, [tracking, filter]);
  const atRisk = (p: ProjectTracking) => {
    const h = projectHealth(p, now);
    return h === "at_risk" || h === "overdue";
  };

  /* ── My tasks ── */
  const [tab, setTab] = useState<HomeTab>("upcoming");
  const lists = useMemo(() => {
    const byDue = (a: Task, b: Task) => {
      const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return ad - bd;
    };
    const byUpdated = (a: Task, b: Task) =>
      new Date(b.completed_at ?? b.updated_at).getTime() -
      new Date(a.completed_at ?? a.updated_at).getTime();
    return {
      upcoming: mine
        .filter((t) => !isDone(t) && !isOverdue(t, today))
        .sort(byDue),
      overdue: mine.filter((t) => isOverdue(t, today)).sort(byDue),
      completed: mine.filter((t) => isDone(t)).sort(byUpdated),
    } satisfies Record<HomeTab, Task[]>;
  }, [mine, today]);
  const cur = lists[tab].slice(0, 7);

  async function toggleDone(t: Task) {
    const next = isDone(t) ? "todo" : "done";
    const key = tasksQueryOptions(propertyId).queryKey;
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<Task[]>(key);
    qc.setQueryData<Task[]>(key, (rows) =>
      rows?.map((r) =>
        r.id === t.id
          ? {
              ...r,
              status: next,
              status_category: next === "done" ? "done" : "open",
              status_blocked: false,
              completed_at:
                next === "done" ? new Date().toISOString() : null,
            }
          : r,
      ),
    );
    const res = await updateTask({ taskId: t.id, status: next });
    if ("error" in res && prev) qc.setQueryData(key, prev);
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["projects-tracking", propertyId] });
  }

  const projectColor = (id: string | null | undefined): string => {
    const p = id ? projectById.get(id) : null;
    return G8_COLOR[(p?.color ?? "slate") as EntityColor] ?? G8_COLOR.slate;
  };

  /* ── Upcoming deadlines ── */
  const deadlineGroups = useMemo(() => {
    const group = (lab: string, a: number, b: number) => ({
      lab,
      ts: open
        .filter((t) => {
          if (!t.due_at) return false;
          const n = dayDiff(t.due_at, today);
          return n >= a && n <= b;
        })
        .sort((x, y) => priorityWeight(y.priority) - priorityWeight(x.priority)),
    });
    return [
      group("Today", 0, 0),
      group("Tomorrow", 1, 1),
      group("This week", 2, 7),
    ];
  }, [open, today]);

  /* ── Recent activity ── */
  const lookup = useActivityLookup(propertyId, userId);
  useActivityLogRealtime(propertyId);
  const { data: activity = [], isPending: activityPending } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "property" }, 7),
  );

  const statsReady = tasksReady && projectsReady;
  const go = (href: string) => router.push(href);

  return (
    <>
      <div className="stats" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="stat"
          onClick={() => go(`${base}/projects`)}
        >
          <span className="k">
            <Gi icon={FolderKanban} size={14} />
            Active projects
          </span>
          <span className="v">
            <CountUp value={activeProjects.length} ready={statsReady} />
          </span>
          <span className="d">
            {activeProjects.filter(atRisk).length} at risk
          </span>
        </button>
        <button
          type="button"
          className="stat"
          onClick={() => go(`${base}/tasks`)}
        >
          <span className="k">
            <Gi icon={CircleDashed} size={14} />
            Open tasks
          </span>
          <span className="v">
            <CountUp value={open.length} ready={statsReady} />
          </span>
          <span className="d">
            {open.filter((t) => isAssignedTo(t, userId)).length} assigned to you
          </span>
        </button>
        <button
          type="button"
          className="stat"
          onClick={() => go(`${base}/tasks`)}
        >
          <span className="k">
            <Gi icon={CircleCheck} size={14} />
            Completed
          </span>
          <span className="v">
            <CountUp value={doneWk.length} ready={statsReady} />
          </span>
          <span className="d up">this week</span>
        </button>
        <button
          type="button"
          className="stat"
          onClick={() => go(`${base}/my-tasks`)}
        >
          <span className="k">
            <Gi icon={ClockAlert} size={14} />
            Overdue
          </span>
          <span
            className="v"
            style={over.length ? { color: "var(--g8-red)" } : undefined}
          >
            <CountUp value={over.length} ready={statsReady} />
          </span>
          <span className={over.length ? "d bad" : "d"}>
            {over.length ? "need attention" : "all on track"}
          </span>
        </button>
      </div>

      <div className="grid2">
        <div className="stack">
          <section className="panel" aria-labelledby="h-mytasks">
            <div className="panel-h">
              <h2 id="h-mytasks">My tasks</h2>
              <div className="acts">
                <div className="seg" role="tablist">
                  {(
                    [
                      ["upcoming", "Upcoming"],
                      ["overdue", "Overdue"],
                      ["completed", "Completed"],
                    ] as const
                  ).map(([k, n]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      className={tab === k ? "on" : ""}
                      onClick={() => setTab(k)}
                    >
                      {n} <span className="faint">{lists[k].length}</span>
                    </button>
                  ))}
                </div>
                <Link
                  href={`${base}/my-tasks`}
                  className="ibtn ibtn-sm"
                  title="Open My Tasks"
                  aria-label="Open My Tasks"
                >
                  <Gi icon={ArrowUpRight} size={15} />
                </Link>
              </div>
            </div>
            {cur.length ? (
              cur.map((t) => {
                const done = isDone(t);
                const pName =
                  t.project_name ??
                  (t.project_id ? projectById.get(t.project_id)?.name : null);
                const n = t.due_at ? dayDiff(t.due_at, today) : null;
                const dueCls =
                  done || n === null ? "" : n < 0 ? "over" : n <= 1 ? "soon" : "";
                return (
                  <div
                    key={t.id}
                    className={done ? "mini done" : "mini"}
                    role="button"
                    tabIndex={0}
                    onClick={() => go(taskHref(propertyId, t.id))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") go(taskHref(propertyId, t.id));
                    }}
                  >
                    <input
                      type="checkbox"
                      className="check round"
                      checked={done}
                      aria-label={`Complete ${t.title}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => void toggleDone(t)}
                    />
                    <span title={t.status_name ?? undefined}>
                      <StIcon task={t} />
                    </span>
                    <span className="tt">{t.title}</span>
                    {pName ? (
                      <span className="pj hide-m">
                        <span
                          className="pdot"
                          style={{ "--g8-c": projectColor(t.project_id) } as CSSVars}
                        />
                        <span className="trunc">{pName}</span>
                      </span>
                    ) : null}
                    <span title={`${PR_NAME[t.priority ?? "none"]} priority`}>
                      <PrIcon priority={t.priority} />
                    </span>
                    <span
                      style={{ width: 74, textAlign: "right" }}
                      className="hide-m"
                    >
                      {t.due_at ? (
                        <span className={dueCls ? `due ${dueCls}` : "due"}>
                          {relDate(t.due_at, today)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="empty-state sm">
                <div className="glyph">
                  <Gi
                    icon={tab === "overdue" ? CircleCheck : ListChecks}
                    size={20}
                  />
                </div>
                <h3 className="es-h">
                  {tab === "overdue" ? "Nothing overdue" : "No tasks here"}
                </h3>
                <p>
                  {tab === "overdue"
                    ? "Every task assigned to you is on schedule."
                    : "Add a task to get things moving."}
                </p>
              </div>
            )}
            {lists[tab].length > 7 ? (
              <button
                type="button"
                className="addrow"
                style={{
                  paddingLeft: 14,
                  borderTop: "1px solid var(--g8-divider)",
                  borderBottom: 0,
                }}
                onClick={() => go(`${base}/my-tasks`)}
              >
                View all {lists[tab].length} tasks{" "}
                <Gi icon={ArrowRight} size={13} />
              </button>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-h">
              <h2>Project progress</h2>
              <div className="acts">
                <Link href={`${base}/projects`} className="btn btn-sm btn-ghost">
                  All projects
                </Link>
              </div>
            </div>
            {activeProjects.length ? (
              <ProjectTable
                projects={activeProjects}
                now={now}
                toAv={toAv}
                onOpen={(id) => openProject(id)}
              />
            ) : (
              <div className="empty-state sm">
                <div className="glyph">
                  <Gi icon={FolderKanban} size={20} />
                </div>
                <h3 className="es-h">No active projects</h3>
                <p>Projects you start will show their progress here.</p>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-h">
              <h2>Upcoming deadlines</h2>
              <div className="acts">
                <Link href={`${base}/calendar`} className="btn btn-sm btn-ghost">
                  <Gi icon={Calendar} size={13} />
                  Calendar
                </Link>
              </div>
            </div>
            <div className="panel-b" style={{ paddingBottom: 6 }}>
              {deadlineGroups.map((g) => (
                <div key={g.lab} style={{ marginBottom: 10 }}>
                  <div
                    className="row"
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--g8-text-2)",
                      marginBottom: 4,
                    }}
                  >
                    {g.lab}
                    <span className="faint" style={{ fontWeight: 500 }}>
                      {g.ts.length}
                    </span>
                  </div>
                  {g.ts.length ? (
                    <>
                      {g.ts.slice(0, 4).map((t) => (
                        <Link
                          key={t.id}
                          href={taskHref(propertyId, t.id)}
                          className="row"
                          style={{
                            height: 30,
                            gap: 8,
                            fontSize: 13,
                            color: "inherit",
                          }}
                        >
                          <span
                            className="pdot"
                            style={
                              { "--g8-c": projectColor(t.project_id) } as CSSVars
                            }
                          />
                          <span className="trunc grow">{t.title}</span>
                          <PrIcon priority={t.priority} size={13} />
                          <Av member={toAv(taskAssigneeIds(t)[0])} />
                        </Link>
                      ))}
                      {g.ts.length > 4 ? (
                        <div
                          className="faint"
                          style={{ fontSize: 11.5, paddingLeft: 16 }}
                        >
                          +{g.ts.length - 4} more
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div
                      className="faint"
                      style={{ fontSize: 12.5, padding: "4px 0 2px" }}
                    >
                      Nothing due
                    </div>
                  )}
                </div>
              ))}
            </div>
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
                        <Av
                          member={{
                            id: desc.actorMember.id,
                            name: desc.actorMember.name,
                            avatarUrl: desc.actorMember.avatarUrl,
                          }}
                        />
                      ) : (
                        <span
                          className="av sm"
                          style={{ "--g8-c": "var(--g8-gray)" } as CSSVars}
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
      </div>
    </>
  );
}

function ProjectTable({
  projects,
  now,
  toAv,
  onOpen,
}: {
  projects: ProjectTracking[];
  now: number;
  toAv: (id: string) => AvMember | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="perm-t" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ paddingLeft: 14 }}>Project</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left", width: "26%" }}>Progress</th>
            <th style={{ textAlign: "left" }}>Due</th>
            <th style={{ textAlign: "right", paddingRight: 14 }}>Team</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const pr = progressPct(p.done, p.total);
            const h = projectHealth(p, now);
            const risk = h === "at_risk" || h === "overdue";
            const status = risk
              ? { name: "At Risk", c: "var(--g8-red)" }
              : p.status === "planned"
                ? { name: "Planning", c: "var(--g8-gray)" }
                : { name: "In Progress", c: "var(--g8-blue)" };
            const team = p.contributorIds
              .map(toAv)
              .filter((m): m is AvMember => m !== null);
            const color = G8_COLOR[p.color] ?? G8_COLOR.slate;
            return (
              <tr
                key={p.id}
                style={{ cursor: "pointer" }}
                tabIndex={0}
                onClick={() => onOpen(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpen(p.id);
                }}
              >
                <td style={{ paddingLeft: 14 }}>
                  <span className="row">
                    <span
                      className="picon"
                      style={{ "--g8-c": color, "--g8-sz": "22px", fontSize: 12 } as CSSVars}
                    >
                      {p.icon ? p.icon : <Gi icon={FolderKanban} size={14} />}
                    </span>
                    <b style={{ fontWeight: 500 }}>{p.name}</b>
                  </span>
                </td>
                <td style={{ textAlign: "left" }}>
                  <PStatus name={status.name} color={status.c} />
                </td>
                <td>
                  <span className="row">
                    <ProgBar value={pr} tone={risk ? "red" : ""} />
                    <span
                      className="num faint"
                      style={{ fontSize: 11.5, width: 30 }}
                    >
                      {pr}%
                    </span>
                  </span>
                </td>
                <td style={{ textAlign: "left" }} className="num muted">
                  {fmtDate(p.target_date)}
                </td>
                <td style={{ textAlign: "right", paddingRight: 14 }}>
                  <AvStack members={team} max={3} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
