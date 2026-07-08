"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import type { OrgChart, OrgTeam } from "@/lib/org/queries";
import type { OrgPerson } from "@/lib/org/queries";
import { TeamEditPopover } from "./team-edit-popover";
import { PersonEditPopover } from "./person-edit-popover";
import { AddTeamDialog } from "./add-team-dialog";
import { PanCanvas } from "./pan-canvas";

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Connector rail + stem for a node sitting in a row of siblings. */
const RAIL =
  "relative flex flex-col items-center px-2.5 pt-6 before:absolute before:top-0 before:left-1/2 before:h-6 before:w-px before:bg-border after:absolute after:top-0 after:right-0 after:left-0 after:h-px after:bg-border first:after:left-1/2 last:after:right-1/2 only:after:hidden";

/** Which parent a pending "add team" targets (null = top level). */
type AddTarget = { id: string | null; name: string | null };

/**
 * The hierarchy diagram — a top-down org chart on a pannable canvas. Property
 * leadership at the root, teams as cards connected by hairline elbows, sub-
 * teams beneath their parent. Management edits structure in place (each card's
 * popover) and adds teams via the dashed "+" placeholders — at the top level,
 * as a sibling of any team, or as a sub-team of a leaf. Two-finger scroll (or
 * drag) pans the canvas; it never scrolls the page.
 */
export function OrgDiagram({
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

  // The root box: whoever runs the property — the GM/owners.
  const leadership = org.people.filter(
    (p) =>
      p.role === "owner" || p.title?.toLowerCase().includes("general manager"),
  );

  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
  const onAddTeam = (id: string | null, name: string | null) =>
    setAddTarget({ id, name });

  return (
    <>
      <PanCanvas className="h-[min(78vh,760px)]">
        <div className="min-w-max px-8 py-8">
          <div className="flex flex-col items-center">
            {/* Root — the property + its leadership. */}
            <div className="w-56 rounded-lg border border-border bg-muted/30 px-4 py-3 text-center">
              <p className="truncate text-sm font-semibold text-foreground">
                {propertyName}
              </p>
              {leadership.length > 0 ? (
                <div className="mt-2 flex flex-col gap-1">
                  {leadership.slice(0, 3).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <Avatar size="sm" className="size-4">
                        {p.avatarUrl ? (
                          <AvatarImage src={p.avatarUrl} alt={p.name ?? ""} />
                        ) : null}
                        <AvatarFallback className="text-[0.5rem]">
                          {initials(p.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">
                        {p.name ?? "Owner"}
                        {p.title ? ` · ${p.title}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="h-6 w-px bg-border" aria-hidden="true" />
            <BranchRow
              teams={roots}
              parentId={null}
              parentName={propertyName}
              org={org}
              openTaskCounts={openTaskCounts}
              propertyId={propertyId}
              isManagement={isManagement}
              onAddTeam={onAddTeam}
              onSelectTeam={onSelectTeam}
            />
          </div>
        </div>
      </PanCanvas>

      {isManagement ? (
        <AddTeamDialog
          propertyId={propertyId}
          parentId={addTarget?.id ?? null}
          parentName={addTarget?.name ?? null}
          open={addTarget !== null}
          onOpenChange={(o) => {
            if (!o) setAddTarget(null);
          }}
        />
      ) : null}
    </>
  );
}

// ── Branch + nodes ───────────────────────────────────────────────────────────

/** A row of sibling team nodes (same parent) with connector rail + stems, plus
 *  a trailing "+" placeholder that adds another team at this level. */
function BranchRow({
  teams,
  parentId,
  parentName,
  org,
  openTaskCounts,
  propertyId,
  isManagement,
  onAddTeam,
  onSelectTeam,
}: {
  teams: OrgTeam[];
  parentId: string | null;
  parentName: string | null;
  org: OrgChart;
  openTaskCounts: Record<string, number>;
  propertyId: string;
  isManagement: boolean;
  onAddTeam: (id: string | null, name: string | null) => void;
  onSelectTeam: (teamId: string) => void;
}) {
  return (
    <ul role="list" className="flex items-start">
      {teams.map((team) => (
        <li key={team.id} className={RAIL}>
          <DiagramNode
            team={team}
            org={org}
            openTaskCounts={openTaskCounts}
            propertyId={propertyId}
            isManagement={isManagement}
            onAddTeam={onAddTeam}
            onSelectTeam={onSelectTeam}
          />
        </li>
      ))}
      {isManagement ? (
        <li className={RAIL}>
          <AddPlaceholder
            label={parentId ? "Sub-team" : "Team"}
            onClick={() => onAddTeam(parentId, parentName)}
          />
        </li>
      ) : null}
    </ul>
  );
}

function DiagramNode({
  team,
  org,
  openTaskCounts,
  propertyId,
  isManagement,
  onAddTeam,
  onSelectTeam,
}: {
  team: OrgTeam;
  org: OrgChart;
  openTaskCounts: Record<string, number>;
  propertyId: string;
  isManagement: boolean;
  onAddTeam: (id: string | null, name: string | null) => void;
  onSelectTeam: (teamId: string) => void;
}) {
  const children = org.teams
    .filter((t) => t.parentId === team.id)
    .sort((a, b) => a.position - b.position);
  const lead = team.leadUserId
    ? org.people.find((p) => p.id === team.leadUserId)
    : undefined;
  const open = openTaskCounts[team.id] ?? 0;

  // The team's own people hierarchy: the head sits in this card, so beneath it
  // hang the people who report to the head (or have no in-team manager), then
  // their reports recursively — the full org chart, not just team → head.
  const head = team.leadUserId;
  const memberSet = new Set(team.memberIds);
  const membersInTeam = team.memberIds
    .map((id) => org.people.find((p) => p.id === id))
    .filter((p): p is OrgPerson => !!p);
  const inTeamMgr = (p: OrgPerson): string | null =>
    p.managerId && p.managerId !== p.id && memberSet.has(p.managerId)
      ? p.managerId
      : null;
  const byName = (a: OrgPerson, b: OrgPerson) =>
    (a.name ?? "").localeCompare(b.name ?? "");
  const reportsOf = (mgrId: string): OrgPerson[] =>
    membersInTeam.filter((p) => p.id !== head && inTeamMgr(p) === mgrId).sort(byName);
  const topPeople = membersInTeam
    .filter((p) => p.id !== head && (inTeamMgr(p) === null || inTeamMgr(p) === head))
    .sort(byName);

  const hasBranch =
    children.length > 0 || topPeople.length > 0 || isManagement;

  return (
    <div className="flex flex-col items-center">
      <div className="group relative w-52 rounded-lg border border-border bg-background px-3.5 py-3">
        <div className="flex items-center gap-2">
          {team.icon ? (
            <span className="shrink-0 text-sm" aria-hidden="true">
              {team.icon}
            </span>
          ) : (
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-[3px]",
                LABEL_DOT[team.color],
              )}
              aria-hidden="true"
            />
          )}
          <button
            type="button"
            onClick={() => onSelectTeam(team.id)}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline"
          >
            {team.name}
          </button>
          {isManagement ? (
            <span className="absolute top-1.5 right-1.5">
              <TeamEditPopover propertyId={propertyId} team={team} org={org} />
            </span>
          ) : null}
        </div>

        {lead ? (
          <div className="mt-2 flex items-center gap-1.5">
            <Avatar size="sm" className="size-5">
              {lead.avatarUrl ? (
                <AvatarImage src={lead.avatarUrl} alt={lead.name ?? ""} />
              ) : null}
              <AvatarFallback className="text-[0.5rem]">
                {initials(lead.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-xs text-foreground">{lead.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {lead.title ?? "Team lead"}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {isManagement ? "No head yet — assign one" : "No head yet"}
          </p>
        )}

        <p className="mt-2 text-xs tabular-nums text-muted-foreground">
          {team.memberIds.length}{" "}
          {team.memberIds.length === 1 ? "member" : "members"}
          {open > 0 ? ` · ${open} open` : ""}
        </p>
      </div>

      {hasBranch ? (
        <>
          <div className="h-6 w-px bg-border" aria-hidden="true" />
          <ul role="list" className="flex items-start">
            {/* People who report to the head, then their reports. */}
            {topPeople.map((p) => (
              <li key={p.id} className={RAIL}>
                <PersonNode
                  person={p}
                  reportsOf={reportsOf}
                  propertyId={propertyId}
                  org={org}
                  teamMemberIds={team.memberIds}
                  isManagement={isManagement}
                  depth={0}
                />
              </li>
            ))}
            {/* Sub-teams reporting into this team. */}
            {children.map((c) => (
              <li key={c.id} className={RAIL}>
                <DiagramNode
                  team={c}
                  org={org}
                  openTaskCounts={openTaskCounts}
                  propertyId={propertyId}
                  isManagement={isManagement}
                  onAddTeam={onAddTeam}
                  onSelectTeam={onSelectTeam}
                />
              </li>
            ))}
            {isManagement ? (
              <li className={RAIL}>
                <AddPlaceholder
                  label="Sub-team"
                  onClick={() => onAddTeam(team.id, team.name)}
                />
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** A person node in the full-hierarchy diagram + their in-team reports. */
function PersonNode({
  person,
  reportsOf,
  propertyId,
  org,
  teamMemberIds,
  isManagement,
  depth,
}: {
  person: OrgPerson;
  reportsOf: (mgrId: string) => OrgPerson[];
  propertyId: string;
  org: OrgChart;
  teamMemberIds: string[];
  isManagement: boolean;
  depth: number;
}) {
  const reports = depth > 8 ? [] : reportsOf(person.id);

  return (
    <div className="flex flex-col items-center">
      <div className="group relative flex w-52 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
        <Avatar className="size-7">
          {person.avatarUrl ? (
            <AvatarImage src={person.avatarUrl} alt={person.name ?? ""} />
          ) : null}
          <AvatarFallback className="text-[0.625rem]">
            {initials(person.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {person.name ?? "Member"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {person.title ?? person.role}
          </p>
        </div>
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
              <li key={r.id} className={RAIL}>
                <PersonNode
                  person={r}
                  reportsOf={reportsOf}
                  propertyId={propertyId}
                  org={org}
                  teamMemberIds={teamMemberIds}
                  isManagement={isManagement}
                  depth={depth + 1}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Dashed add-a-team card used as the trailing sibling in a branch row. */
function AddPlaceholder({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[4.75rem] w-52 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Plus className="size-4" />
      Add {label.toLowerCase()}
    </button>
  );
}
