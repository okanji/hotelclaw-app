"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, Folder, KeyRound, ListChecks, Mail, User, Users } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { PageHeader } from "@/components/shell/page-header";
import { GuestAccessDialog } from "@/components/members/guest-access-dialog";
import { useUrlTab } from "@/components/projects/workspace-shell";
import { useActivityLogRealtime, useActivityLookup } from "@/components/activity/activity-log";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { projectsQueryOptions } from "@/lib/query/project-queries";
import { isAssignedTo } from "@/lib/tasks/assignees";
import { isDone } from "@/lib/tasks/statuses";
import { canManage } from "@/lib/auth/roles";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import type { Task } from "@/components/tasks/kanban";
import { G8_COLOR } from "./home-glyphs";
import { dayDiff, startOfDay } from "./my-tasks-glyphs";
import {
  AvXl,
  FeedItem,
  G8Empty,
  MiniTaskRow,
  RoleBadge,
  byDue,
  propertySpaceMembersQueryOptions,
} from "./members-shared";
import { MemberMenu, RoleMenu, useMemberActions, useMemberDirectory } from "./members-view";
import { TeamIcon, teamsWithDescQueryOptions } from "./teams-grid";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * Member profile — gr8r-studio's `pageMember` (src/pages/members.js) at
 * `/p/<pid>/members/<userId>`: `.av.xl` header with role badge + contact
 * row, the four `.stats`, then `.grid2` — Assigned / Completed tabs of
 * `miniRow`s (any assignee — `isAssignedTo`), and a side stack of Teams
 * (`space_members`), Active projects and Recent activity (`activity_log`
 * actor scope). Role change / remove / guest Access reuse the members page's
 * hooks over our server actions.
 */

const MEMBER_ROUTE = /^\/p\/[^/]+\/members\/([^/]+)\/?$/;
const EMPTY_TASKS: Task[] = [];

export function MemberProfilePage({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();
  const userId = pathname.match(MEMBER_ROUTE)?.[1];
  if (!userId) return null;
  return <MemberProfile key={userId} propertyId={propertyId} userId={userId} />;
}

export function MemberProfile({ propertyId, userId }: { propertyId: string; userId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { meId, members, isPending, myRole } = useMemberDirectory(propertyId);
  const m = members.find((x) => x.id === userId) ?? null;
  const [tab, setTab] = useUrlTab("assigned");
  const [accessOpen, setAccessOpen] = useState(false);
  const [today] = useState(() => startOfDay(new Date()));
  const base = `/p/${propertyId}`;

  const { data: tasks = EMPTY_TASKS } = useQuery(tasksQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: teams = [] } = useQuery(teamsWithDescQueryOptions(propertyId));
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const { data: membersBySpace = {} } = useQuery(
    propertySpaceMembersQueryOptions(propertyId, teamIds),
  );
  const lookup = useActivityLookup(propertyId, meId);
  useActivityLogRealtime(propertyId);
  const { data: acts = [] } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "actor", id: userId }, 8),
  );

  const actions = useMemberActions(
    propertyId,
    m ?? { id: userId, role: "staff", name: null, email: null, avatarUrl: null },
    () => qc.invalidateQueries({ queryKey: ["property-members", propertyId] }),
    () => router.push(`${base}/members`),
  );

  const mine = useMemo(() => tasks.filter((t) => isAssignedTo(t, userId)), [tasks, userId]);
  const open = useMemo(() => mine.filter((t) => !isDone(t)).sort(byDue), [mine]);
  const done = useMemo(
    () =>
      mine
        .filter((t) => isDone(t))
        .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at)),
    [mine],
  );
  const overdue = open.filter((t) => t.due_at && dayDiff(t.due_at, today) < 0).length;
  const projectColor = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, G8_COLOR[p.color]]));
    return (id: string | null | undefined) => (id ? byId.get(id) : undefined) ?? "var(--g8-gray)";
  }, [projects]);
  const activeProjects = useMemo(() => {
    const ids = new Set(open.map((t) => t.project_id).filter(Boolean));
    return projects.filter(
      (p) =>
        (p.status === "active" || p.status === "planned") &&
        (ids.has(p.id) || p.lead_user_id === userId),
    );
  }, [projects, open, userId]);
  const myTeams = useMemo(
    () => teams.filter((t) => (membersBySpace[t.id] ?? []).includes(userId)),
    [teams, membersBySpace, userId],
  );

  if (isPending)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Member" icon={<User />} />
        <div className="page">
          <div className="faint">Loading…</div>
        </div>
      </div>
    );
  if (!m)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Member" icon={<User />} />
        <div className="page">
          <G8Empty icon={User} title="Member not found" text="This person isn't a member of this property.">
            <Link href={`${base}/members`} className="btn btn-secondary btn-sm">
              <Gi icon={ArrowLeft} size={13} />
              Back to members
            </Link>
          </G8Empty>
        </div>
      </div>
    );

  const isOwner = myRole === "owner";
  const canChangeRole = isOwner && m.id !== meId;
  const canManageGuest = canManage(myRole) && m.role === "guest";
  const list = tab === "completed" ? done : open;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Members", href: `${base}/members`, icon: <Users /> },
          { label: m.name ?? "Unnamed" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page">
          <div
            className="row"
            style={{ gap: 18, marginBottom: 22, flexWrap: "wrap", alignItems: "flex-start" }}
          >
            <AvXl member={m} />
            <div className="grow" style={{ minWidth: 220 }}>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <h1
                  style={{
                    fontSize: "var(--g8-fs-2xl)",
                    margin: 0,
                    fontWeight: 600,
                    letterSpacing: "-.02em",
                  }}
                >
                  {m.name ?? "Unnamed"}
                  {m.id === meId ? (
                    <span className="faint" style={{ fontWeight: 400 }}>
                      {" "}
                      (you)
                    </span>
                  ) : null}
                </h1>
                <RoleBadge role={m.role} />
              </div>
              <div className="muted" style={{ marginTop: 3 }}>
                {myTeams.length
                  ? myTeams.map((t) => t.name).join(" · ")
                  : m.role === "guest"
                    ? "Outside collaborator — sees only what's shared"
                    : "No team yet"}
              </div>
              {m.email ? (
                <div
                  className="row faint"
                  style={{ marginTop: 8, gap: 14, fontSize: 12.5, flexWrap: "wrap" }}
                >
                  <span className="row" style={{ gap: 5 }}>
                    <Gi icon={Mail} size={13} />
                    <span style={{ userSelect: "all" }}>{m.email}</span>
                  </span>
                </div>
              ) : null}
            </div>
            <div className="row">
              {m.email ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(m.email ?? "");
                    toast.success("Email copied");
                  }}
                >
                  <Gi icon={Copy} size={14} />
                  Copy email
                </button>
              ) : null}
              {canManageGuest ? (
                <button type="button" className="btn btn-secondary" onClick={() => setAccessOpen(true)}>
                  <Gi icon={KeyRound} size={14} />
                  Access
                </button>
              ) : null}
              {canChangeRole && m.role !== "guest" ? (
                <RoleMenu member={m} onPick={actions.changeRole} disabled={actions.pending} />
              ) : null}
              {canChangeRole || canManageGuest ? (
                <MemberMenu
                  member={m}
                  canRemove={canChangeRole}
                  canManageGuest={canManageGuest}
                  onAccess={() => setAccessOpen(true)}
                  onRemove={actions.remove}
                  size={16}
                />
              ) : null}
            </div>
          </div>

          <div className="stats" style={{ marginBottom: 18 }}>
            <div className="stat">
              <span className="k">Active projects</span>
              <span className="v">{activeProjects.length}</span>
            </div>
            <div className="stat">
              <span className="k">Assigned tasks</span>
              <span className="v">{open.length}</span>
            </div>
            <div className="stat">
              <span className="k">Completed tasks</span>
              <span className="v">{done.length}</span>
            </div>
            <div className="stat">
              <span className="k">Overdue</span>
              <span className="v" style={overdue ? { color: "var(--g8-red)" } : undefined}>
                {overdue}
              </span>
            </div>
          </div>

          <div className="grid2">
            <section className="panel">
              <div className="tabs" role="tablist" style={{ padding: "0 8px" }}>
                {(
                  [
                    ["assigned", `Assigned · ${open.length}`],
                    ["completed", `Completed · ${done.length}`],
                  ] as const
                ).map(([k, n]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    className={tab === k ? "tab on" : "tab"}
                    onClick={() => setTab(k)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {list.length ? (
                list.slice(0, 50).map((t) => (
                  <MiniTaskRow
                    key={t.id}
                    task={t}
                    propertyId={propertyId}
                    today={today}
                    projectColor={projectColor}
                  />
                ))
              ) : (
                <G8Empty icon={ListChecks} title="No tasks here" text="Nothing to show in this list." sm />
              )}
            </section>

            <div className="stack">
              <section className="panel">
                <div className="panel-h">
                  <h2>Teams</h2>
                  <span className="faint">{myTeams.length}</span>
                </div>
                {myTeams.length ? (
                  myTeams.map((t) => (
                    <Link key={t.id} href={`${base}/spaces/${t.id}`} className="mini">
                      <TeamIcon team={t} />
                      <span className="tt">{t.name}</span>
                    </Link>
                  ))
                ) : (
                  <div className="panel-b faint">
                    <Gi icon={Users} size={13} /> Not on a team
                  </div>
                )}
              </section>
              <section className="panel">
                <div className="panel-h">
                  <h2>Active projects</h2>
                </div>
                {activeProjects.length ? (
                  activeProjects.map((p) => (
                    <Link key={p.id} href={`${base}/projects/${p.id}`} className="mini">
                      <span className="picon" style={{ "--g8-c": G8_COLOR[p.color] } as CSSVars}>
                        {p.icon ? (
                          <span style={{ fontSize: 14, lineHeight: 1 }}>{p.icon}</span>
                        ) : (
                          <Gi icon={Folder} size={14} />
                        )}
                      </span>
                      <span className="tt">{p.name}</span>
                      <span className="faint" style={{ fontSize: 12 }}>
                        {p.lead_user_id === m.id ? "Lead" : "Member"}
                      </span>
                    </Link>
                  ))
                ) : (
                  <div className="panel-b faint">No active projects</div>
                )}
              </section>
              <section className="panel">
                <div className="panel-h">
                  <h2>Recent activity</h2>
                </div>
                <div className="panel-b feed">
                  {acts.length ? (
                    acts.map((a) => <FeedItem key={a.id} row={a} lookup={lookup} showProject />)
                  ) : (
                    <span className="faint">No recent activity</span>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
      {canManageGuest ? (
        <GuestAccessDialog
          propertyId={propertyId}
          guest={{ id: m.id, name: m.name }}
          open={accessOpen}
          onOpenChange={setAccessOpen}
        />
      ) : null}
    </div>
  );
}
