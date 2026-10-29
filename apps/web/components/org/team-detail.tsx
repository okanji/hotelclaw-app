"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ListChecks, Users } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { Av, G8_COLOR } from "@/components/gr8r/home-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
import type { OrgChart, OrgPerson, OrgTeam } from "@/lib/org/queries";
import { PersonEditPopover } from "./person-edit-popover";
import { TreeScroller } from "./tree-scroller";
import { TeamEditPopover } from "./team-edit-popover";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

/**
 * Team detail — everyone in one team and their reporting hierarchy WITHIN it.
 * A team isn't flat: the head runs it, supervisors may sit under the head,
 * front-line staff under them. We build that tree from `manager_id` scoped to
 * the team's roster: root is the head; anyone whose manager is also on the
 * team nests under them; members with no in-team manager attach under the head
 * so the chart stays connected. Members not on any reporting line still appear.
 */
export function TeamDetail({
  propertyId,
  team,
  org,
  openTaskCount,
  isManagement,
  onBack,
}: {
  propertyId: string;
  team: OrgTeam;
  org: OrgChart;
  openTaskCount: number;
  isManagement: boolean;
  onBack: () => void;
}) {
  const members = useMemo(
    () =>
      team.memberIds
        .map((id) => org.people.find((p) => p.id === id))
        .filter((p): p is OrgPerson => !!p),
    [team.memberIds, org.people],
  );
  const memberSet = useMemo(
    () => new Set(team.memberIds),
    [team.memberIds],
  );
  const head = team.leadUserId;

  // parent within the team: your in-team manager, else the head (except the
  // head itself, which is the root). Yields one connected tree.
  const parentOf = (p: OrgPerson): string | null => {
    if (p.id === head) return null;
    if (p.managerId && memberSet.has(p.managerId)) return p.managerId;
    return head && memberSet.has(head) ? head : null;
  };

  const childrenOf = (id: string | null): OrgPerson[] =>
    members
      .filter((p) => parentOf(p) === id)
      .sort((a, b) => {
        if (a.id === head) return -1;
        if (b.id === head) return 1;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });

  const roots = childrenOf(null);

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 12, marginLeft: -8 }}>
        <Gi icon={ArrowLeft} size={14} />
        Org chart
      </button>

      <div className="ph">
        <div className="row" style={{ alignItems: "flex-start", gap: 12, minWidth: 0 }}>
          {team.icon ? (
            <span className="shrink-0 text-2xl" aria-hidden="true">
              {team.icon}
            </span>
          ) : (
            <span
              className="picon lg"
              style={{ "--g8-c": G8_COLOR[team.color] } as React.CSSProperties}
              aria-hidden="true"
            >
              <Gi icon={Users} size={18} />
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}>
              <h1>{team.name}</h1>
              {isManagement ? (
                <span className="group">
                  <TeamEditPopover
                    propertyId={propertyId}
                    team={team}
                    org={org}
                  />
                </span>
              ) : null}
            </div>
            {team.description ? <p style={{ maxWidth: "60ch" }}>{team.description}</p> : null}
            <p className="num">
              {members.length} {members.length === 1 ? "person" : "people"} ·{" "}
              {openTaskCount} open tasks
            </p>
          </div>
        </div>
        <div className="acts">
          <Link href={`/p/${propertyId}/tasks?space=${team.id}`} className="btn btn-secondary">
            <Gi icon={ListChecks} size={14} />
            View board
          </Link>
        </div>
      </div>

      <section className="panel">
        <div className="panel-h">
          <h2>Reporting hierarchy</h2>
        </div>
        {members.length === 0 ? (
          <G8Empty
            icon={Users}
            title="No one on this team yet"
            text={`Add people to ${team.name} from the People directory or the team page, then set who reports to whom here.`}
            sm
          />
        ) : (
          <div className="panel-b">
            <TreeScroller>
              <div className="min-w-max py-2">
                <ul role="list" className="flex items-start">
                  {roots.map((p) => (
                    <PersonBranch
                      key={p.id}
                      person={p}
                      childrenOf={childrenOf}
                      head={head}
                      propertyId={propertyId}
                      org={org}
                      teamMemberIds={team.memberIds}
                      isManagement={isManagement}
                      depth={0}
                    />
                  ))}
                </ul>
              </div>
            </TreeScroller>
          </div>
        )}
      </section>
    </div>
  );
}

/** A person node + their in-team reports, with the connector rail. */
function PersonBranch({
  person,
  childrenOf,
  head,
  propertyId,
  org,
  teamMemberIds,
  isManagement,
  depth,
}: {
  person: OrgPerson;
  childrenOf: (id: string | null) => OrgPerson[];
  head: string | null;
  propertyId: string;
  org: OrgChart;
  teamMemberIds: string[];
  isManagement: boolean;
  depth: number;
}) {
  const reports = depth > 8 ? [] : childrenOf(person.id);
  const rail =
    "relative flex flex-col items-center px-1 pt-4 before:absolute before:top-0 before:left-1/2 before:h-4 before:w-px before:bg-(--g8-border-strong) after:absolute after:top-0 after:right-0 after:left-0 after:h-px after:bg-(--g8-border-strong) first:after:left-1/2 last:after:right-1/2 only:after:hidden";

  return (
    <li className={depth === 0 ? "flex flex-col items-center" : rail}>
      <div className="flex flex-col items-center">
        <div
          className="group relative flex w-48 items-center gap-2"
          style={{
            padding: "8px 10px",
            background: "var(--g8-surface)",
            border: "1px solid var(--g8-border)",
            borderRadius: "var(--g8-r)",
            boxShadow: "var(--g8-shadow-sm)",
          }}
        >
          <Av member={person} size="md" />
          <div className="min-w-0 flex-1">
            <p className="trunc" style={{ margin: 0, fontWeight: 500 }}>
              {person.name ?? "Member"}
            </p>
            <p className="trunc faint" style={{ margin: 0, fontSize: "var(--g8-fs-xs)" }}>
              {person.title ?? ROLE_LABEL[person.role] ?? person.role}
            </p>
          </div>
          {person.id === head ? <span className="badge accent">Head</span> : null}
          {isManagement ? (
            <PersonEditPopover
              propertyId={propertyId}
              person={person}
              org={org}
              teamMemberIds={teamMemberIds}
            />
          ) : null}
        </div>

        {reports.length > 0 ? (
          <>
            <div className="h-4 w-px bg-(--g8-border-strong)" aria-hidden="true" />
            <ul role="list" className="flex items-start">
              {reports.map((r) => (
                <PersonBranch
                  key={r.id}
                  person={r}
                  childrenOf={childrenOf}
                  head={head}
                  propertyId={propertyId}
                  org={org}
                  teamMemberIds={teamMemberIds}
                  isManagement={isManagement}
                  depth={depth + 1}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </li>
  );
}
