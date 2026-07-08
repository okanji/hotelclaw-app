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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import {
  orgChartQueryOptions,
  type OrgChartResponse,
} from "@/lib/query/org-queries";
import type { OrgChart, OrgPerson, OrgTeam } from "@/lib/org/queries";
import { updatePersonHierarchy } from "./actions";
import { OrgDiagram } from "./org-diagram";
import { TeamDetail } from "./team-detail";
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

  // The diagram canvas spans the full inset width (SHELL padding only); text
  // blocks stay in a readable 6xl column via WRAP.
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto pt-12 pb-16 sm:pt-16">
      <header className={cn(WRAP, "flex flex-col gap-5")}>
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Company
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground">
          Org chart
        </h1>
        <p className="max-w-[56ch] text-base leading-relaxed text-pretty text-muted-foreground">
          How the property is organized — teams and who runs them, reporting
          lines, and each person&apos;s role. Everyone works from the same
          picture, and so do the AI assistants.
        </p>
      </header>

      {isPending || !data ? (
        <div className={cn(WRAP, "mt-12 flex flex-col gap-3")}>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : selectedTeam ? (
        <div className={cn(WRAP, "mt-10")}>
          <TeamDetail
            propertyId={propertyId}
            team={selectedTeam}
            org={data}
            openTaskCount={data.openTaskCounts[selectedTeam.id] ?? 0}
            isManagement={isManagement}
            onBack={() => setSelectedTeamId(null)}
          />
        </div>
      ) : (
        <OrgBody
          propertyId={propertyId}
          propertyName={propertyName}
          org={data}
          isManagement={isManagement}
          onSelectTeam={setSelectedTeamId}
        />
      )}
    </div>
  );
}

/** Readable centered column for text blocks. */
const WRAP = "mx-auto w-full max-w-6xl px-8 sm:px-14";
/** Full-inset width with matching side padding (for the diagram canvas). */
const FULL = "w-full px-8 sm:px-14";

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
  const reportingCount = org.people.filter((p) => p.managerId).length;
  const [structureView, setStructureView] = useState<"diagram" | "list">(
    "diagram",
  );

  return (
    <>
      <div className={cn(WRAP, "mt-10 flex gap-8 border-t border-border pt-5 text-sm")}>
        <Stat value={org.teams.length} label="teams" />
        <Stat value={org.people.length} label="people" />
        <Stat value={reportingCount} label="reporting lines" />
      </div>

      <section className="mt-14 min-w-0">
        <div className={structureView === "diagram" ? FULL : WRAP}>
          <SectionHeader
            kicker="Structure"
            title="Teams"
            actions={
              <div className="flex gap-1">
                <ViewToggleButton
                  active={structureView === "diagram"}
                  label="Diagram"
                  icon={<Network className="size-4" />}
                  onClick={() => setStructureView("diagram")}
                />
                <ViewToggleButton
                  active={structureView === "list"}
                  label="List"
                  icon={<ListTree className="size-4" />}
                  onClick={() => setStructureView("list")}
                />
              </div>
            }
          />
        </div>
        {structureView === "diagram" ? (
          <div className={FULL}>
            <OrgDiagram
              propertyId={propertyId}
              propertyName={propertyName}
              org={org}
              openTaskCounts={org.openTaskCounts}
              isManagement={isManagement}
              onSelectTeam={onSelectTeam}
            />
          </div>
        ) : (
          <div className={WRAP}>
            <TeamsTree
              propertyId={propertyId}
              propertyName={propertyName}
              org={org}
              openTaskCounts={org.openTaskCounts}
              isManagement={isManagement}
              onSelectTeam={onSelectTeam}
            />
          </div>
        )}
      </section>

      <section className={cn(WRAP, "mt-16 min-w-0")}>
        <SectionHeader kicker="Directory" title="People" />
        <PeopleDirectory
          propertyId={propertyId}
          org={org}
          isManagement={isManagement}
        />
      </section>
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-lg font-semibold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function SectionHeader({
  kicker,
  title,
  actions,
}: {
  kicker: string;
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 border-b border-border pb-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          {kicker}
        </span>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      {actions}
    </div>
  );
}

function ViewToggleButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
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
      <EmptyState icon={Users} title="No teams yet">
        Add teams like Front Office, Housekeeping, or F&amp;B from the Home
        sidebar, then organize them here.
      </EmptyState>
    );
  }

  // A true outline: the property at the root, teams beneath it (nested by
  // parent), and each team's people beneath the team — so the whole
  // property → team → person hierarchy reads top to bottom.
  return (
    <div>
      <div className="flex items-center gap-2 py-1.5 pl-1.5">
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold text-foreground">
          {propertyName}
        </span>
      </div>
      <ul role="list" className="ml-3 flex flex-col gap-1 border-l border-border pl-3">
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
      <div className="group flex items-center gap-2 rounded-md py-1.5 pr-1.5 pl-1.5 hover:bg-muted/50">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse" : "Expand"}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            !hasDetail && "invisible",
          )}
        >
          <ChevronRight
            className={cn("size-4 transition-transform", open && "rotate-90")}
          />
        </button>

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

        {lead ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar size="sm" className="size-4">
              {lead.avatarUrl ? (
                <AvatarImage src={lead.avatarUrl} alt={lead.name ?? ""} />
              ) : null}
              <AvatarFallback className="text-[0.5rem]">
                {initials(lead.name)}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-[14ch] truncate">{lead.name ?? "Lead"}</span>
          </span>
        ) : null}

        {/* Live load — links to this team's board. */}
        {openTaskCounts[team.id] ? (
          <Link
            href={`/p/${propertyId}/tasks?space=${team.id}`}
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground hover:text-foreground"
          >
            {openTaskCounts[team.id]} open
          </Link>
        ) : null}

        <span
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
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
        <div className="ml-3.5 flex flex-col gap-1 border-l border-border pl-3">
          {members.map((p) => (
            <MemberRow
              key={p.id}
              person={p}
              isLead={p.id === team.leadUserId}
            />
          ))}
          {children.length > 0 ? (
            <ul role="list" className="flex flex-col gap-1">
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
    <div className="flex items-center gap-2 py-1 pl-1.5">
      <Avatar size="sm" className="size-5">
        {person.avatarUrl ? (
          <AvatarImage src={person.avatarUrl} alt={person.name ?? ""} />
        ) : null}
        <AvatarFallback className="text-[0.5rem]">
          {initials(person.name)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 truncate text-sm text-foreground">
        {person.name ?? "Member"}
      </span>
      {person.title ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {person.title}
        </span>
      ) : null}
      {isLead ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          Head
        </span>
      ) : null}
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
      <EmptyState icon={Users} title="No people yet">
        Invite teammates to the property and they&apos;ll appear here.
      </EmptyState>
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
      <div className="relative mb-2 max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          name="peopleSearch"
          aria-label="Search people"
          placeholder="Search name, title, or team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 pl-8"
        />
      </div>
      {people.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No one matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul role="list" className="divide-y divide-border">
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
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 items-center gap-3 sm:w-52 sm:shrink-0">
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
            {ROLE_LABEL[person.role] ?? person.role}
            {!isManagement && person.title ? ` · ${person.title}` : ""}
            {!isManagement && teamName(person.primaryTeamId)
              ? ` · ${teamName(person.primaryTeamId)}`
              : ""}
          </p>
        </div>
      </div>

      {isManagement ? (
        <div className="grid grid-cols-1 gap-2 pl-11 sm:grid-cols-3 sm:gap-3 sm:pl-0 min-w-0 flex-1">
          <Input
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
            className="h-8 text-sm"
          />
          <NativeSelect
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
          </NativeSelect>
          <NativeSelect
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
          </NativeSelect>
        </div>
      ) : person.managerId ? (
        <p className="pl-11 text-xs text-muted-foreground sm:pl-0">
          Reports to{" "}
          <span className="text-foreground">
            {personName(person.managerId) ?? "—"}
          </span>
        </p>
      ) : null}
    </li>
  );
}
