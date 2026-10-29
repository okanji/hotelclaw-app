"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  ChevronRight,
  ListTree,
  Network,
  Search,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { Av, G8_COLOR } from "@/components/gr8r/home-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
import {
  orgChartQueryOptions,
  type OrgChartResponse,
} from "@/lib/query/org-queries";
import type { OrgChart, OrgPerson, OrgTeam } from "@/lib/org/queries";
import { updatePersonHierarchy } from "./actions";
import { OrgDiagram } from "./org-diagram";
import { TeamDetail } from "./team-detail";
import { TeamEditPopover } from "./team-edit-popover";
import { OrgProposals } from "./org-proposals";

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

/**
 * Org chart — the company hierarchy. A Home sub-view (`/home/org`). Two
 * sections: the Teams tree (who runs what, nested by parent) and the People
 * directory (titles + reporting lines + home team). Owners/managers edit in
 * place; everyone else reads. The same data feeds the AI's `get_org_chart`.
 */
export function OrgView({
  propertyId,
  propertyName,
  isManagement,
}: {
  propertyId: string;
  propertyName: string;
  isManagement: boolean;
}) {
  const { data, isPending } = useQuery(orgChartQueryOptions(propertyId));
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const selectedTeam =
    (selectedTeamId && data?.teams.find((t) => t.id === selectedTeamId)) ||
    null;

  // ONE width for the whole page (`page`, 960). The diagram used to break out
  // to the full pane while every text block sat in a centred 6xl column, which
  // gave the page two left edges; the diagram scrolls horizontally inside its
  // own container (see `tree-scroller`), so it does not need the extra width.
  const reportingCount = data?.people.filter((p) => p.managerId).length ?? 0;

  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader title="Org chart" icon={<Network />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 1160 }}>
          {isPending || !data ? (
            <div className="stack">
              <span className="sk" style={{ height: 24, width: 160 }} />
              <span className="sk" style={{ height: 96 }} />
              <span className="sk" style={{ height: 96 }} />
            </div>
          ) : selectedTeam ? (
            <TeamDetail
              propertyId={propertyId}
              team={selectedTeam}
              org={data}
              openTaskCount={data.openTaskCounts[selectedTeam.id] ?? 0}
              isManagement={isManagement}
              onBack={() => setSelectedTeamId(null)}
            />
          ) : (
            <>
              <div className="ph">
                <div>
                  <h1>Org chart</h1>
                  <p>
                    Who runs what at {propertyName} — teams nested by parent,
                    people by reporting line.
                  </p>
                </div>
              </div>
              <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 16 }}>
                <OrgStat icon={Users} value={data.teams.length} label="Teams" />
                <OrgStat icon={Users} value={data.people.length} label="People" />
                <OrgStat icon={Network} value={reportingCount} label="Reporting lines" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <OrgProposals propertyId={propertyId} org={data} />
              </div>
              <OrgBody
                propertyId={propertyId}
                propertyName={propertyName}
                org={data}
                isManagement={isManagement}
                onSelectTeam={setSelectedTeamId}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OrgBody({
  propertyId,
  propertyName,
  org,
  isManagement,
  onSelectTeam,
}: {
  propertyId: string;
  propertyName: string;
  org: OrgChartResponse;
  isManagement: boolean;
  onSelectTeam: (teamId: string) => void;
}) {
  const [structureView, setStructureView] = useState<"diagram" | "list">(
    "diagram",
  );

  return (
    <div className="stack">
      <section className="panel" style={{ minWidth: 0 }}>
        <div className="panel-h">
          <span className="eyebrow">Structure</span>
          <h2>Teams</h2>
          <div className="acts">
            <div className="seg" role="tablist" aria-label="Structure view">
              <button
                type="button"
                role="tab"
                aria-selected={structureView === "diagram"}
                className={structureView === "diagram" ? "on" : ""}
                onClick={() => setStructureView("diagram")}
              >
                <Gi icon={Network} size={13} />
                Diagram
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={structureView === "list"}
                className={structureView === "list" ? "on" : ""}
                onClick={() => setStructureView("list")}
              >
                <Gi icon={ListTree} size={13} />
                List
              </button>
            </div>
          </div>
        </div>
        <div className="panel-b" style={{ minWidth: 0 }}>
          {structureView === "diagram" ? (
            <OrgDiagram
              propertyId={propertyId}
              propertyName={propertyName}
              org={org}
              openTaskCounts={org.openTaskCounts}
              isManagement={isManagement}
              onSelectTeam={onSelectTeam}
            />
          ) : (
            <TeamsTree
              propertyId={propertyId}
              propertyName={propertyName}
              org={org}
              openTaskCounts={org.openTaskCounts}
              isManagement={isManagement}
              onSelectTeam={onSelectTeam}
            />
          )}
        </div>
      </section>

      <section className="panel" style={{ minWidth: 0 }}>
        <div className="panel-h">
          <span className="eyebrow">Directory</span>
          <h2>People</h2>
          <span className="faint num">{org.people.length}</span>
        </div>
        <PeopleDirectory
          propertyId={propertyId}
          org={org}
          isManagement={isManagement}
        />
      </section>
    </div>
  );
}

function OrgStat({
  icon,
  value,
  label,
}: {
  icon: React.ComponentProps<typeof Gi>["icon"];
  value: number;
  label: string;
}) {
  return (
    <div className="stat">
      <span className="k">
        <Gi icon={icon} size={13} />
        {label}
      </span>
      <span className="v">{value}</span>
    </div>
  );
}

// ── Teams ──────────────────────────────────────────────────────────────────

function TeamsTree({
  propertyId,
  propertyName,
  org,
  openTaskCounts,
  isManagement,
  onSelectTeam,
}: {
  propertyId: string;
  propertyName: string;
  org: OrgChart;
  openTaskCounts: Record<string, number>;
  isManagement: boolean;
  onSelectTeam: (teamId: string) => void;
}) {
  const byId = useMemo(
    () => new Map(org.teams.map((t) => [t.id, t])),
    [org.teams],
  );
  const roots = useMemo(
    () =>
      org.teams
        .filter((t) => !t.parentId || !byId.has(t.parentId))
        .sort((a, b) => a.position - b.position),
    [org.teams, byId],
  );

  if (org.teams.length === 0) {
    return (
      <G8Empty
        icon={Users}
        title="No teams yet"
        text="Add teams like Front Office, Housekeeping, or F&B from the sidebar, then organize them here."
        sm
      />
    );
  }

  // A true outline: the property at the root, teams beneath it (nested by
  // parent), and each team's people beneath the team — so the whole
  // property → team → person hierarchy reads top to bottom.
  return (
    <div>
      <div className="row" style={{ padding: "6px 6px" }}>
        <span className="faint" style={{ display: "inline-flex" }}>
          <Gi icon={Building2} size={15} />
        </span>
        <span className="trunc" style={{ fontWeight: 600 }}>
          {propertyName}
        </span>
      </div>
      <ul
        role="list"
        className="flex flex-col"
        style={{ margin: "0 0 0 12px", padding: "0 0 0 12px", listStyle: "none", gap: 2, borderLeft: "1px solid var(--g8-border)" }}
      >
        {roots.map((t) => (
          <TeamNode
            key={t.id}
            team={t}
            org={org}
            openTaskCounts={openTaskCounts}
            depth={0}
            propertyId={propertyId}
            isManagement={isManagement}
            onSelectTeam={onSelectTeam}
          />
        ))}
      </ul>
    </div>
  );
}

function TeamNode({
  team,
  org,
  openTaskCounts,
  depth,
  propertyId,
  isManagement,
  onSelectTeam,
}: {
  team: OrgTeam;
  org: OrgChart;
  openTaskCounts: Record<string, number>;
  depth: number;
  propertyId: string;
  isManagement: boolean;
  onSelectTeam: (teamId: string) => void;
}) {
  const children = org.teams
    .filter((t) => t.parentId === team.id)
    .sort((a, b) => a.position - b.position);
  const lead = team.leadUserId
    ? org.people.find((p) => p.id === team.leadUserId)
    : undefined;
  // Members shown under the team — lead first, then the rest.
  const members = team.memberIds
    .map((id) => org.people.find((p) => p.id === id))
    .filter((p): p is OrgPerson => !!p)
    .sort((a, b) => {
      if (a.id === team.leadUserId) return -1;
      if (b.id === team.leadUserId) return 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  const hasDetail = children.length > 0 || members.length > 0;
  const [open, setOpen] = useState(true);

  return (
    <li>
      <div
        className="group row hover:bg-(--g8-surface-2)"
        style={{ padding: "5px 6px", borderRadius: "var(--g8-r-sm)" }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse" : "Expand"}
          className={cn("ibtn ibtn-xs", !hasDetail && "invisible")}
        >
          <Gi
            icon={ChevronRight}
            size={13}
            className={cn("transition-transform", open && "rotate-90")}
          />
        </button>

        {team.icon ? (
          <span className="shrink-0 text-sm" aria-hidden="true">
            {team.icon}
          </span>
        ) : (
          <span
            className="pdot"
            style={{ "--g8-c": G8_COLOR[team.color] } as CSSVars}
            aria-hidden="true"
          />
        )}

        <button
          type="button"
          onClick={() => onSelectTeam(team.id)}
          className="trunc hover:underline"
          style={{ flex: 1, textAlign: "left", fontWeight: 500 }}
        >
          {team.name}
        </button>

        {lead ? (
          <span className="row faint" style={{ gap: 6, flexShrink: 0, fontSize: "var(--g8-fs-xs)" }}>
            <Av member={lead} />
            <span className="trunc" style={{ maxWidth: "14ch" }}>
              {lead.name ?? "Lead"}
            </span>
          </span>
        ) : null}

        {/* Live load — links to this team's board. */}
        {openTaskCounts[team.id] ? (
          <Link
            href={`/p/${propertyId}/tasks?space=${team.id}`}
            className="badge gray num"
            style={{ flexShrink: 0 }}
          >
            {openTaskCounts[team.id]} open
          </Link>
        ) : null}

        <span
          className="faint num"
          style={{ flexShrink: 0, fontSize: "var(--g8-fs-xs)" }}
          title={`${team.memberIds.length} ${team.memberIds.length === 1 ? "member" : "members"}`}
        >
          {team.memberIds.length}
        </span>

        {isManagement ? (
          <TeamEditPopover
            propertyId={propertyId}
            team={team}
            org={org}
          />
        ) : null}
      </div>

      {open && hasDetail ? (
        <div
          className="flex flex-col"
          style={{ marginLeft: 14, paddingLeft: 12, gap: 2, borderLeft: "1px solid var(--g8-border)" }}
        >
          {members.map((p) => (
            <MemberRow
              key={p.id}
              person={p}
              isLead={p.id === team.leadUserId}
            />
          ))}
          {children.length > 0 ? (
            <ul role="list" className="flex flex-col" style={{ margin: 0, padding: 0, listStyle: "none", gap: 2 }}>
              {children.map((c) => (
                <TeamNode
                  key={c.id}
                  team={c}
                  org={org}
                  openTaskCounts={openTaskCounts}
                  depth={depth + 1}
                  propertyId={propertyId}
                  isManagement={isManagement}
                  onSelectTeam={onSelectTeam}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** A person row under a team in the list outline. */
function MemberRow({
  person,
  isLead,
}: {
  person: OrgPerson;
  isLead: boolean;
}) {
  return (
    <div className="row" style={{ padding: "4px 6px", gap: 8 }}>
      <Av member={person} />
      <span className="trunc">{person.name ?? "Member"}</span>
      {person.title ? (
        <span className="trunc faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
          {person.title}
        </span>
      ) : null}
      {isLead ? <span className="badge accent">Head</span> : null}
    </div>
  );
}


// ── People ─────────────────────────────────────────────────────────────────

function PeopleDirectory({
  propertyId,
  org,
  isManagement,
}: {
  propertyId: string;
  org: OrgChart;
  isManagement: boolean;
}) {
  const teamName = (id: string | null) =>
    id ? (org.teams.find((t) => t.id === id)?.name ?? null) : null;
  const personName = (id: string | null) =>
    id ? (org.people.find((p) => p.id === id)?.name ?? null) : null;

  const [query, setQuery] = useState("");

  if (org.people.length === 0) {
    return (
      <G8Empty
        icon={Users}
        title="No people yet"
        text="Invite teammates to the property and they'll appear here."
        sm
      />
    );
  }

  // Sort owners → managers → staff, then by name.
  const rank: Record<string, number> = { owner: 0, manager: 1, staff: 2 };
  const q = query.trim().toLowerCase();
  const people = [...org.people]
    .filter((p) => {
      if (!q) return true;
      // Match on name, title, role, or home-team name.
      return [
        p.name,
        p.title,
        p.role,
        teamName(p.primaryTeamId),
      ]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    })
    .sort(
      (a, b) =>
        (rank[a.role] ?? 3) - (rank[b.role] ?? 3) ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );

  return (
    <>
      <div style={{ padding: "0 14px 10px" }}>
        <div className="inwrap" style={{ maxWidth: 320 }}>
          <Gi icon={Search} size={13} />
          <input
            type="search"
            name="peopleSearch"
            className="input search-sm"
            aria-label="Search people"
            placeholder="Search name, title, or team…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {people.length === 0 ? (
        <p className="faint" style={{ margin: 0, padding: "20px 14px", textAlign: "center" }}>
          No one matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {people.map((person) => (
            <PersonRow
              key={person.id}
              propertyId={propertyId}
              person={person}
              org={org}
              isManagement={isManagement}
              teamName={teamName}
              personName={personName}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function PersonRow({
  propertyId,
  person,
  org,
  isManagement,
  teamName,
  personName,
}: {
  propertyId: string;
  person: OrgPerson;
  org: OrgChart;
  isManagement: boolean;
  teamName: (id: string | null) => string | null;
  personName: (id: string | null) => string | null;
}) {
  const qc = useQueryClient();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(person.title ?? "");

  function save(
    patch: {
      title?: string | null;
      managerId?: string | null;
      primaryTeamId?: string | null;
    },
  ) {
    start(async () => {
      const res = await updatePersonHierarchy(propertyId, person.id, patch);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      qc.invalidateQueries({ queryKey: ["org-chart", propertyId] });
    });
  }

  return (
    <li
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
      style={{ padding: "10px 14px", borderTop: "1px solid var(--g8-divider)" }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:w-56 sm:shrink-0">
        <Av member={person} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="trunc" style={{ margin: 0, fontWeight: 500 }}>
            {person.name ?? "Member"}
          </p>
          <p className="trunc faint" style={{ margin: 0, fontSize: "var(--g8-fs-xs)" }}>
            {ROLE_LABEL[person.role] ?? person.role}
            {!isManagement && person.title ? ` · ${person.title}` : ""}
            {!isManagement && teamName(person.primaryTeamId)
              ? ` · ${teamName(person.primaryTeamId)}`
              : ""}
          </p>
          {person.email ? (
            <p className="trunc faint" style={{ margin: 0, fontSize: "var(--g8-fs-xs)" }}>
              {person.email}
            </p>
          ) : null}
        </div>
      </div>

      {isManagement ? (
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            className="input"
            aria-label={`Title for ${person.name ?? "member"}`}
            name={`title-${person.id}`}
            placeholder="Job title"
            value={title}
            disabled={pending}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if ((person.title ?? "") !== title.trim())
                save({ title: title.trim() || null });
            }}
          />
          <select
            className="select"
            aria-label={`Reports to, for ${person.name ?? "member"}`}
            disabled={pending}
            value={person.managerId ?? ""}
            onChange={(e) => save({ managerId: e.target.value || null })}
          >
            <option value="">Reports to…</option>
            {org.people
              .filter((p) => p.id !== person.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? "Member"}
                </option>
              ))}
          </select>
          <select
            className="select"
            aria-label={`Home team for ${person.name ?? "member"}`}
            disabled={pending}
            value={person.primaryTeamId ?? ""}
            onChange={(e) => save({ primaryTeamId: e.target.value || null })}
          >
            <option value="">Home team…</option>
            {org.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ) : person.managerId ? (
        <p className="faint" style={{ margin: 0, fontSize: "var(--g8-fs-xs)" }}>
          Reports to{" "}
          <span style={{ color: "var(--g8-text)" }}>
            {personName(person.managerId) ?? "—"}
          </span>
        </p>
      ) : null}
    </li>
  );
}
