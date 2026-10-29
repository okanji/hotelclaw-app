"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Folder, Inbox, IterationCcw, Layers, ListChecks } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { PageHeader } from "@/components/shell/page-header";
import { projectsQueryOptions } from "@/lib/query/project-queries";
import { tasksQueryOptions, type PropertyMember } from "@/lib/query/section-queries";
import type { ActivityLogRow } from "@/lib/query/activity-log-queries";
import type { ActivityLookup } from "@/components/activity/activity-log";
import { cyclesHref } from "@/lib/query/cycle-queries";
import { isDone } from "@/lib/tasks/statuses";
import type { EntityColor } from "@/lib/db/types";
import type { Task } from "@/components/tasks/kanban";
import { Av, G8_COLOR, PStatus, ProgBar } from "./home-glyphs";
import { startOfDay } from "./my-tasks-glyphs";
import { FeedItem, G8Empty, MiniTaskRow, RoleBadge, byDue } from "./members-shared";
import { TeamIcon } from "./teams-grid";

/**
 * Team page — gr8r-studio's `pageTeam` (src/pages/members.js) over our
 * space workspace. `TeamPageShell` is the chrome (topbar crumbs + actions,
 * `.page.wide` › header › `.tabs`), `TeamOverview` the gr8r `.grid2`:
 * Projects + Open tasks on the left, Members / Go to / Sub-teams / Recent
 * activity on the right. Every other tab keeps its existing panel.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;
const EMPTY_TASKS: Task[] = [];

export type TeamTab = { id: string; label: string; count?: number; content: React.ReactNode };

export function TeamPageShell({
  crumbs,
  actions,
  header,
  tabs,
  active,
  onTab,
}: {
  crumbs: React.ReactNode;
  actions?: React.ReactNode;
  header: React.ReactNode;
  tabs: TeamTab[];
  active: string;
  onTab: (id: string) => void;
}) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader start={crumbs} actions={actions} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          {header}
          <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === current?.id}
                className={t.id === current?.id ? "tab on" : "tab"}
                onClick={() => onTab(t.id)}
              >
                {t.label}
                {typeof t.count === "number" && t.count > 0 ? (
                  <span className="faint" style={{ marginLeft: 4 }}>
                    {t.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {current?.content}
        </div>
      </div>
    </div>
  );
}

/** The `.ph` row: big team icon (slot for the colour picker), title + description, actions. */
export function TeamHeader({
  icon,
  title,
  description,
  acts,
  below,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  acts?: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <>
      <div className="ph">
        <div className="row" style={{ gap: 12, alignItems: "flex-start", minWidth: 0, flex: 1 }}>
          <span style={{ marginTop: 2 }}>{icon}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            {title}
            <div style={{ marginTop: 2 }}>{description}</div>
          </div>
        </div>
        {acts ? <div className="acts">{acts}</div> : null}
      </div>
      {below ? (
        <div className="stack" style={{ marginBottom: 16 }}>
          {below}
        </div>
      ) : null}
    </>
  );
}

export { TeamIcon };

export function TeamOverview({
  propertyId,
  spaceId,
  projects,
  roster,
  subTeams,
  triageCount,
  taskCount,
  activity,
  activityLookup,
  onSeeActivity,
  onSeeMembers,
  extra,
}: {
  propertyId: string;
  spaceId: string;
  projects: { id: string; name: string; color: EntityColor; done: number; total: number }[];
  roster: PropertyMember[];
  subTeams: { id: string; name: string; color: EntityColor; icon: string | null }[];
  triageCount: number;
  taskCount: number;
  activity: ActivityLogRow[];
  activityLookup: ActivityLookup;
  onSeeActivity: () => void;
  onSeeMembers: () => void;
  /** Our overview blocks with no gr8r slot (scoreboard, progress, pinned). */
  extra?: React.ReactNode;
}) {
  const base = `/p/${propertyId}`;
  const [today] = useState(() => startOfDay(new Date()));
  const { data: allTasks = EMPTY_TASKS } = useQuery(tasksQueryOptions(propertyId));
  const { data: allProjects = [] } = useQuery(projectsQueryOptions(propertyId));
  const projectById = useMemo(() => new Map(allProjects.map((p) => [p.id, p])), [allProjects]);
  const projectColor = useMemo(
    () => (id: string | null | undefined) =>
      (id ? G8_COLOR[projectById.get(id)?.color ?? "slate"] : undefined) ?? "var(--g8-gray)",
    [projectById],
  );
  const open = useMemo(
    () => allTasks.filter((t) => t.space_id === spaceId && !isDone(t)).sort(byDue),
    [allTasks, spaceId],
  );
  const memberById = useMemo(() => new Map(roster.map((m) => [m.id, m])), [roster]);
  const peopleById = activityLookup.members;

  return (
    <div className="stack">
      <div className="grid2">
        <div className="stack">
          <section className="panel">
            <div className="panel-h">
              <h2>Projects</h2>
              <span className="faint">{projects.length}</span>
            </div>
            {projects.length ? (
              projects.map((p) => {
                const full = projectById.get(p.id);
                const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                return (
                  <Link key={p.id} href={`${base}/projects/${p.id}`} className="mini">
                    <span className="picon" style={{ "--g8-c": G8_COLOR[p.color] } as CSSVars}>
                      {full?.icon ? (
                        <span style={{ fontSize: 14, lineHeight: 1 }}>{full.icon}</span>
                      ) : (
                        <Gi icon={Folder} size={14} />
                      )}
                    </span>
                    <span className="tt">{p.name}</span>
                    {full ? <PStatus name={statusName(full.status)} color={statusColor(full.status)} /> : null}
                    <span className="row" style={{ width: 120 }} title={`${p.done}/${p.total} done`}>
                      <ProgBar value={pct} />
                    </span>
                  </Link>
                );
              })
            ) : (
              <div className="panel-b faint">No projects</div>
            )}
          </section>
          <section className="panel">
            <div className="panel-h">
              <h2>Open tasks</h2>
              <span className="faint">{open.length}</span>
              <span className="sp" />
              <Link href={`${base}/tasks?space=${spaceId}`} className="btn btn-ghost btn-sm">
                View all
              </Link>
            </div>
            {open.length ? (
              open.slice(0, 8).map((t) => (
                <MiniTaskRow
                  key={t.id}
                  task={t}
                  propertyId={propertyId}
                  today={today}
                  projectColor={projectColor}
                  assignee={t.assignee_id ? (memberById.get(t.assignee_id) ?? peopleById.get(t.assignee_id) ?? null) : null}
                />
              ))
            ) : (
              <G8Empty icon={ListChecks} title="No open tasks" text="Everything on this team is done." sm />
            )}
          </section>
        </div>

        <div className="stack" style={{ alignSelf: "start" }}>
          <section className="panel">
            <div className="panel-h">
              <h2>Members</h2>
              <span className="faint">{roster.length}</span>
              <span className="sp" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={onSeeMembers}>
                Manage
              </button>
            </div>
            {roster.length ? (
              roster.map((m) => (
                <Link
                  key={m.id}
                  href={`${base}/members/${m.id}`}
                  className="mini"
                  style={{ minHeight: 48 }}
                >
                  <Av member={m} size="md" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="trunc" style={{ fontWeight: 500 }}>
                      {m.name ?? "Unnamed"}
                    </div>
                    {m.email ? (
                      <div className="faint trunc" style={{ fontSize: 12 }}>
                        {m.email}
                      </div>
                    ) : null}
                  </div>
                  <RoleBadge role={m.role} />
                </Link>
              ))
            ) : (
              <div className="panel-b faint">No members yet</div>
            )}
          </section>

          <section className="panel">
            <div className="panel-h">
              <h2>Go to</h2>
            </div>
            <GoRow href={`${base}/triage?team=${spaceId}`} icon={<Gi icon={Inbox} size={14} />} label="Triage" count={triageCount} />
            <GoRow href={`${base}/tasks?space=${spaceId}`} icon={<Gi icon={Layers} size={14} />} label="Tasks" count={taskCount} />
            <GoRow href={cyclesHref(propertyId, spaceId)} icon={<Gi icon={IterationCcw} size={14} />} label="Cycles" />
          </section>

          {subTeams.length ? (
            <section className="panel">
              <div className="panel-h">
                <h2>Sub-teams</h2>
                <span className="faint">{subTeams.length}</span>
              </div>
              {subTeams.map((t) => (
                <GoRow
                  key={t.id}
                  href={`${base}/spaces/${t.id}`}
                  icon={<TeamIcon team={t} />}
                  label={t.name || "Untitled team"}
                />
              ))}
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-h">
              <h2>Recent activity</h2>
              <span className="sp" />
              {activity.length ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onSeeActivity}>
                  See all
                </button>
              ) : null}
            </div>
            <div className="panel-b feed">
              {activity.length ? (
                activity
                  .slice(0, 6)
                  .map((a) => <FeedItem key={a.id} row={a} lookup={activityLookup} showProject />)
              ) : (
                <span className="faint">No recent activity</span>
              )}
            </div>
          </section>
        </div>
      </div>
      {extra}
    </div>
  );
}

function GoRow({
  href,
  icon,
  label,
  count,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <Link href={href} className="mini">
      {icon}
      <span className="tt">{label}</span>
      {count ? <span className="faint" style={{ fontSize: 12 }}>{count}</span> : null}
    </Link>
  );
}

function statusName(s: string): string {
  return s === "active" ? "Active" : s === "planned" ? "Planned" : s === "completed" ? "Completed" : "Archived";
}
function statusColor(s: string): string {
  return s === "active"
    ? "var(--g8-blue)"
    : s === "completed"
      ? "var(--g8-green)"
      : s === "planned"
        ? "var(--g8-violet)"
        : "var(--g8-gray)";
}
