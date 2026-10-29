"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Crown,
  Ellipsis,
  KeyRound,
  MailCheck,
  Minus,
  Plus,
  Search,
  SearchX,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { PageHeader } from "@/components/shell/page-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InviteDialog } from "@/components/shell/invite-dialog";
import { InvitesDialog } from "@/components/shell/invites-dialog";
import { GuestAccessDialog } from "@/components/members/guest-access-dialog";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import { useUrlTab } from "@/components/projects/workspace-shell";
import { useViewerId } from "@/components/activity/activity-log";
import { removeMember, updateMemberRole } from "@/lib/members/actions";
import { FULL_ROLES, ROLE_ORDER, canManage, type FullRole } from "@/lib/auth/roles";
import {
  propertyMembersQueryOptions,
  tasksQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";
import { projectsQueryOptions } from "@/lib/query/project-queries";
import { isAssignedTo } from "@/lib/tasks/assignees";
import { isDone } from "@/lib/tasks/statuses";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import type { Role } from "@/lib/db/types";
import type { Task } from "@/components/tasks/kanban";
import { Av } from "./home-glyphs";
import { dayDiff, startOfDay } from "./my-tasks-glyphs";
import {
  G8Empty,
  ROLE_LABEL,
  ROLE_RANK,
  propertySpaceMembersQueryOptions,
} from "./members-shared";
import { TeamsGrid, teamsWithDescQueryOptions } from "./teams-grid";

/**
 * Members — gr8r-studio's `pageMembers` (src/pages/members.js): `.page.wide`
 * › `.ph` (count + Invite), tabs Members / Teams / Roles & permissions, the
 * Members tab a `.perm-t` table with search + role `.seg`. Our data: the
 * members API (roles owner / manager / staff / guest), open + overdue work
 * via `isAssignedTo`, teams from `space_members`, pending invites from the
 * invites API (management only). Actions reuse our dialogs + server actions:
 * Invite (`InviteDialog`), Manage invites (`InvitesDialog`), role change /
 * remove (`updateMemberRole` / `removeMember` — owner only, like the People
 * dialog), guest Access (`GuestAccessDialog` — owner / manager).
 */

const IN_MEMBERS = /^\/p\/[^/]+\/members\/?$/;

const EMPTY_TASKS: Task[] = [];

type InviteRow = {
  token: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "expired";
  createdAt: string;
};

export function MembersPage({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();
  if (!IN_MEMBERS.test(pathname)) return null;
  return <MembersView propertyId={propertyId} />;
}

/** Shared by the list and the profile: members + viewer role + derived counts. */
export function useMemberDirectory(propertyId: string) {
  const meId = useViewerId();
  const { data: members = [], isPending } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const myRole = (members.find((m) => m.id === meId)?.role ?? null) as Role | null;
  return { meId, members, isPending, myRole };
}

export function MembersView({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { meId, members, isPending, myRole } = useMemberDirectory(propertyId);
  const isOwner = myRole === "owner";
  const isMgmt = canManage(myRole);
  const [tab, setTab] = useUrlTab("members");
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"all" | Role>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [newTeamOpen, setNewTeamOpen] = useState(false);
  const [accessFor, setAccessFor] = useState<PropertyMember | null>(null);
  const [today] = useState(() => startOfDay(new Date()));

  const { data: tasks = EMPTY_TASKS } = useQuery(tasksQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: teams = [] } = useQuery(teamsWithDescQueryOptions(propertyId));
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const { data: membersBySpace = {} } = useQuery(
    propertySpaceMembersQueryOptions(propertyId, teamIds),
  );
  const { data: invites } = useQuery({
    queryKey: ["property-invites", propertyId],
    enabled: isMgmt,
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/invites`, { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load invites");
      return (await r.json()) as { pending: InviteRow[]; past: InviteRow[] };
    },
  });
  const pendingInvites = useMemo(() => invites?.pending ?? [], [invites]);

  const teamsOf = useMemo(() => {
    const out = new Map<string, { id: string; name: string }[]>();
    for (const t of teams) {
      for (const uid of membersBySpace[t.id] ?? []) {
        const list = out.get(uid) ?? [];
        list.push({ id: t.id, name: t.name });
        out.set(uid, list);
      }
    }
    return out;
  }, [teams, membersBySpace]);

  const statsOf = useMemo(() => {
    const open = tasks.filter((t) => !isDone(t));
    const activeProjects = new Set(
      projects.filter((p) => p.status === "active" || p.status === "planned").map((p) => p.id),
    );
    return (id: string) => {
      const mine = open.filter((t) => isAssignedTo(t, id));
      const ps = new Set<string>();
      for (const t of mine) if (t.project_id && activeProjects.has(t.project_id)) ps.add(t.project_id);
      for (const p of projects) if (p.lead_user_id === id && activeProjects.has(p.id)) ps.add(p.id);
      return {
        open: mine.length,
        overdue: mine.filter((t) => t.due_at && dayDiff(t.due_at, today) < 0).length,
        projects: ps.size,
      };
    };
  }, [tasks, projects, today]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return members
      .filter(
        (m) =>
          (role === "all" || m.role === role) &&
          (!term ||
            (m.name ?? "").toLowerCase().includes(term) ||
            (m.email ?? "").toLowerCase().includes(term)),
      )
      .sort(
        (a, b) =>
          (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      );
  }, [members, q, role]);
  const filteredInvites = useMemo(() => {
    const term = q.trim().toLowerCase();
    return pendingInvites.filter(
      (i) => (role === "all" || i.role === role) && (!term || i.email.toLowerCase().includes(term)),
    );
  }, [pendingInvites, q, role]);

  const base = `/p/${propertyId}`;
  const guests = members.filter((m) => m.role === "guest").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Members" icon={<Users />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide" style={{ maxWidth: 1200 }}>
          <div className="ph">
            <div>
              <h1>Members</h1>
              <p>
                {members.length} {members.length === 1 ? "person" : "people"}
                {guests ? ` · ${guests} ${guests === 1 ? "guest" : "guests"}` : ""}
                {isMgmt ? ` · ${pendingInvites.length} pending` : ""}
              </p>
            </div>
            {isMgmt ? (
              <div className="acts">
                <button type="button" className="btn btn-secondary" onClick={() => setInvitesOpen(true)}>
                  <Gi icon={MailCheck} size={14} />
                  Manage invites
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
                  <Gi icon={UserPlus} size={14} />
                  Invite member
                </button>
              </div>
            ) : null}
          </div>

          <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
            {(
              [
                ["members", "Members"],
                ["teams", "Teams"],
                ["roles", "Roles & permissions"],
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

          {tab === "teams" ? (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  {teams.length} {teams.length === 1 ? "team" : "teams"}
                </span>
                <span className="sp" />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewTeamOpen(true)}>
                  <Gi icon={Plus} size={13} />
                  New team
                </button>
              </div>
              <TeamsGrid propertyId={propertyId} onNewTeam={() => setNewTeamOpen(true)} />
            </>
          ) : tab === "roles" ? (
            <PermsTable />
          ) : (
            <>
              <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                <div className="inwrap">
                  <Gi icon={Search} size={13} />
                  <input
                    className="input search-sm"
                    placeholder="Search by name or email"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="Search members"
                  />
                </div>
                <div className="seg">
                  {(["all", ...ROLE_ORDER] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={role === r ? "on" : ""}
                      onClick={() => setRole(r)}
                    >
                      {r === "all" ? "All" : ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="panel" style={{ overflowX: "auto" }}>
                {isPending ? (
                  <div className="panel-b faint">Loading members…</div>
                ) : filtered.length || filteredInvites.length ? (
                  <table className="perm-t" style={{ minWidth: 880 }}>
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: 14 }}>Member</th>
                        <th style={{ textAlign: "left" }}>Role</th>
                        <th style={{ textAlign: "left" }}>Teams</th>
                        <th>Active projects</th>
                        <th>Open tasks</th>
                        <th>Overdue</th>
                        <th style={{ textAlign: "left" }}>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((m) => (
                        <MemberRow
                          key={m.id}
                          member={m}
                          propertyId={propertyId}
                          href={`${base}/members/${m.id}`}
                          isMe={m.id === meId}
                          canChangeRole={isOwner && m.id !== meId}
                          canManageGuest={isMgmt && m.role === "guest"}
                          teams={teamsOf.get(m.id) ?? []}
                          stats={statsOf(m.id)}
                          onAccess={() => setAccessFor(m)}
                          onChanged={() =>
                            qc.invalidateQueries({ queryKey: ["property-members", propertyId] })
                          }
                        />
                      ))}
                      {filteredInvites.map((i) => (
                        <tr key={i.token}>
                          <td style={{ paddingLeft: 14 }}>
                            <span className="row" style={{ gap: 10 }}>
                              <Av member={null} size="md" />
                              <span className="col">
                                <b style={{ fontWeight: 500 }}>{i.email}</b>
                                <span className="faint" style={{ fontSize: 12 }}>
                                  Invited {new Date(i.createdAt).toLocaleDateString()}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td style={{ textAlign: "left" }}>
                            <span className="pillbtn">{ROLE_LABEL[i.role] ?? i.role}</span>
                          </td>
                          <td style={{ textAlign: "left" }} className="faint">—</td>
                          <td className="num faint">—</td>
                          <td className="num faint">—</td>
                          <td className="num faint">—</td>
                          <td style={{ textAlign: "left" }}>
                            <span className="badge amber">
                              <span className="dot" />
                              Invited
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="ibtn ibtn-sm"
                              aria-label="Manage invite"
                              title="Manage invite"
                              onClick={() => setInvitesOpen(true)}
                            >
                              <Gi icon={Ellipsis} size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <G8Empty icon={SearchX} title="No results found" text="No members match that search." sm />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {isMgmt ? (
        <>
          <InviteDialog propertyId={propertyId} open={inviteOpen} onOpenChange={setInviteOpen} />
          <InvitesDialog
            propertyId={propertyId}
            open={invitesOpen}
            onOpenChange={setInvitesOpen}
            onInviteNew={() => setInviteOpen(true)}
          />
        </>
      ) : null}
      {accessFor ? (
        <GuestAccessDialog
          propertyId={propertyId}
          guest={{ id: accessFor.id, name: accessFor.name }}
          open
          onOpenChange={(o) => {
            if (!o) setAccessFor(null);
          }}
        />
      ) : null}
      <CreateEntityDialog
        open={newTeamOpen}
        onOpenChange={setNewTeamOpen}
        propertyId={propertyId}
        kind="space"
      />
    </div>
  );
}

function MemberRow({
  member: m,
  propertyId,
  href,
  isMe,
  canChangeRole,
  canManageGuest,
  teams,
  stats,
  onAccess,
  onChanged,
}: {
  member: PropertyMember;
  propertyId: string;
  href: string;
  isMe: boolean;
  canChangeRole: boolean;
  canManageGuest: boolean;
  teams: { id: string; name: string }[];
  stats: { open: number; overdue: number; projects: number };
  onAccess: () => void;
  onChanged: () => void;
}) {
  const actions = useMemberActions(propertyId, m, onChanged);
  const isGuest = m.role === "guest";
  return (
    <tr>
      <td style={{ paddingLeft: 14 }}>
        <Link href={href} className="row" style={{ gap: 10, textAlign: "left" }}>
          <Av member={m} size="md" />
          <span className="col">
            <b style={{ fontWeight: 500 }}>
              {m.name ?? "Unnamed"}
              {isMe ? (
                <span className="faint" style={{ fontWeight: 400 }}>
                  {" "}
                  (you)
                </span>
              ) : null}
            </b>
            {m.email ? (
              <span className="faint" style={{ fontSize: 12 }}>
                {m.email}
              </span>
            ) : null}
          </span>
        </Link>
      </td>
      <td style={{ textAlign: "left" }}>
        {canChangeRole && !isGuest ? (
          <RoleMenu member={m} onPick={actions.changeRole} disabled={actions.pending} />
        ) : (
          <span className="pillbtn">
            {m.role === "owner" ? <Gi icon={Crown} size={13} /> : null}
            {ROLE_LABEL[m.role] ?? m.role}
          </span>
        )}
      </td>
      <td style={{ textAlign: "left" }}>
        {teams.length ? (
          <span className="row trunc" style={{ maxWidth: 220 }}>
            {teams.slice(0, 2).map((t, i) => (
              <span key={t.id}>
                {i ? ", " : ""}
                <Link href={`/p/${propertyId}/spaces/${t.id}`}>{t.name}</Link>
              </span>
            ))}
            {teams.length > 2 ? <span className="faint"> +{teams.length - 2}</span> : null}
          </span>
        ) : (
          <span className="faint">—</span>
        )}
      </td>
      <td className="num">{stats.projects}</td>
      <td className="num">{stats.open}</td>
      <td className="num" style={stats.overdue ? { color: "var(--g8-red)" } : undefined}>
        {stats.overdue}
      </td>
      <td style={{ textAlign: "left" }}>
        {isGuest ? (
          <span className="badge amber">
            <span className="dot" />
            Guest
          </span>
        ) : (
          <span className="badge green">
            <span className="dot" />
            Active
          </span>
        )}
      </td>
      <td>
        {canChangeRole || canManageGuest ? (
          <MemberMenu
            member={m}
            canRemove={canChangeRole}
            canManageGuest={canManageGuest}
            onAccess={onAccess}
            onRemove={actions.remove}
          />
        ) : null}
      </td>
    </tr>
  );
}

/** Role change + remove through the existing server actions (owner only). */
export function useMemberActions(
  propertyId: string,
  member: PropertyMember,
  onChanged: () => void,
  onRemoved?: () => void,
) {
  const [pending, start] = useTransition();
  function changeRole(next: FullRole) {
    if (next === member.role) return;
    start(async () => {
      const res = await updateMemberRole({ propertyId, userId: member.id, role: next });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`${member.name ?? "Member"} is now ${ROLE_LABEL[next] ?? next}.`);
      onChanged();
    });
  }
  function remove() {
    if (
      !window.confirm(
        `Remove ${member.name ?? "this member"} from this property? Their account and other properties are unaffected.`,
      )
    )
      return;
    start(async () => {
      const res = await removeMember({ propertyId, userId: member.id });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`${member.name ?? "Member"} removed from this property.`);
      onChanged();
      onRemoved?.();
    });
  }
  return { pending, changeRole, remove };
}

export function RoleMenu({
  member,
  onPick,
  disabled,
}: {
  member: PropertyMember;
  onPick: (r: FullRole) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="pillbtn bordered"
            disabled={disabled}
            aria-label={`Change role for ${member.name ?? "member"}`}
          />
        }
      >
        {member.role === "owner" ? <Gi icon={Crown} size={13} /> : null}
        {ROLE_LABEL[member.role] ?? member.role}
        <Gi icon={ChevronDown} size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {FULL_ROLES.map((r) => (
          <DropdownMenuItem key={r} onClick={() => onPick(r)} className="gap-2">
            <Check style={{ opacity: member.role === r ? 1 : 0 }} className="size-4" />
            {ROLE_LABEL[r]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MemberMenu({
  member,
  canRemove,
  canManageGuest,
  onAccess,
  onRemove,
  size = 14,
}: {
  member: PropertyMember;
  canRemove: boolean;
  canManageGuest: boolean;
  onAccess: () => void;
  onRemove: () => void;
  size?: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={size > 14 ? "ibtn" : "ibtn ibtn-sm"}
            aria-label="Member options"
          />
        }
      >
        <Gi icon={Ellipsis} size={size} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canManageGuest ? (
          <DropdownMenuItem onClick={onAccess} className="gap-2">
            <KeyRound className="size-4" />
            Guest access…
          </DropdownMenuItem>
        ) : null}
        {canManageGuest && canRemove ? <DropdownMenuSeparator /> : null}
        {canRemove ? (
          <DropdownMenuItem onClick={onRemove} variant="destructive" className="gap-2">
            <UserMinus className="size-4" />
            Remove {member.name ? member.name.split(" ")[0] : "member"}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** gr8r `permsTable()` — our role ladder (lib/auth/roles.ts + 0118 RLS). */
function PermsTable() {
  // 1 = allowed, 0 = not, string = a qualified yes.
  const rows: [string, ...(0 | 1 | string)[]][] = [
    ["View tasks, docs & channels", 1, 1, 1, "Shared only"],
    ["Comment on tasks", 1, 1, 1, "Shared only"],
    ["Create and edit tasks", 1, 1, 1, "With edit access"],
    ["Delete tasks", 1, 1, 1, 0],
    ["Create projects & teams", 1, 1, 1, 0],
    ["Insights, workflows & agents", 1, 1, 1, 0],
    ["Invite members", 1, 1, 0, 0],
    ["Manage guest access", 1, 1, 0, 0],
    ["Edit status pipelines", 1, 1, 0, 0],
    ["Change roles & remove people", 1, 0, 0, 0],
  ];
  return (
    <div className="panel" style={{ overflowX: "auto" }}>
      <table className="perm-t" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ paddingLeft: 14 }}>Permission</th>
            {ROLE_ORDER.map((r) => (
              <th key={r}>{ROLE_LABEL[r]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, ...vals]) => (
            <tr key={label}>
              <td style={{ paddingLeft: 14 }}>{label}</td>
              {vals.map((v, i) =>
                typeof v === "string" ? (
                  <td key={i} className="muted" style={{ fontSize: 12 }}>
                    {v}
                  </td>
                ) : (
                  <td key={i}>
                    {v ? (
                      <span style={{ color: "var(--g8-green)", display: "inline-flex" }} aria-label="Allowed">
                        <Gi icon={Check} size={15} />
                      </span>
                    ) : (
                      <span className="faint" style={{ display: "inline-flex" }} aria-label="Not allowed">
                        <Gi icon={Minus} size={15} />
                      </span>
                    )}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
