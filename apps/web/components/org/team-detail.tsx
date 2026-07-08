"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ListChecks, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import type { OrgChart, OrgPerson, OrgTeam } from "@/lib/org/queries";
import { PanCanvas } from "./pan-canvas";
import { PersonEditPopover } from "./person-edit-popover";
import { TeamEditPopover } from "./team-edit-popover";

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

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
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="mb-4 -ml-2 text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
        Org chart
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="flex min-w-0 items-start gap-3">
          {team.icon ? (
            <span className="mt-0.5 shrink-0 text-2xl" aria-hidden="true">
              {team.icon}
            </span>
          ) : (
            <span
              className={cn(
                "mt-2 size-4 shrink-0 rounded",
                LABEL_DOT[team.color],
              )}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {team.name}
              </h2>
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
            {team.description ? (
              <p className="mt-1 max-w-[60ch] text-sm text-pretty text-muted-foreground">
                {team.description}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {members.length} {members.length === 1 ? "person" : "people"}
              </span>
              <span className="tabular-nums">{openTaskCount} open tasks</span>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/p/${propertyId}/tasks?space=${team.id}`} />}
        >
          <ListChecks className="size-4" />
          View board
        </Button>
      </div>

      {members.length === 0 ? (
        <EmptyState icon={Users} title="No one on this team yet" className="mt-8">
          Add people to {team.name} from the People directory or the team page,
          then set who reports to whom here.
        </EmptyState>
      ) : (
        <>
          <p className="mt-8 mb-3 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Reporting hierarchy
          </p>
          <PanCanvas className="h-[min(56vh,480px)]">
            <div className="min-w-max px-8 py-8">
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
          </PanCanvas>
        </>
      )}
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
    "relative flex flex-col items-center px-2.5 pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:w-px before:bg-border after:absolute after:top-0 after:right-0 after:left-0 after:h-px after:bg-border first:after:left-1/2 last:after:right-1/2 only:after:hidden";

  return (
    <li className={depth === 0 ? "flex flex-col items-center" : rail}>
      <div className="flex flex-col items-center">
        <div className="group relative flex w-52 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
          <Avatar className="size-8">
            {person.avatarUrl ? (
              <AvatarImage src={person.avatarUrl} alt={person.name ?? ""} />
            ) : null}
            <AvatarFallback>{initials(person.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {person.name ?? "Member"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {person.title ?? ROLE_LABEL[person.role] ?? person.role}
            </p>
          </div>
          {person.id === head ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              Head
            </span>
          ) : null}
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
            <div className="h-6 w-px bg-border" aria-hidden="true" />
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
