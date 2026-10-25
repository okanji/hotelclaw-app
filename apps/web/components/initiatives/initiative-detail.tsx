"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Check, ChevronRight, MoreHorizontal, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import type { InitiativeStatus } from "@/lib/db/types";
import { initiativeQueryOptions } from "@/lib/query/initiative-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import { formatTarget, pct } from "@/lib/initiatives/planning";
import {
  ActivityLogFeed,
  ActivityLogList,
  useActivityLogRealtime,
  useActivityLookup,
  useViewerId,
} from "@/components/activity/activity-log";
import {
  MetadataItem,
  MetadataRow,
  OverviewSection,
  PropertyRow,
  RailDate,
  RailGroup,
  RailProgress,
  railValueClass,
  WorkspaceShell,
  ws,
  type WorkspaceTab,
} from "@/components/projects/workspace-shell";
import { WorkspaceDescription } from "@/components/projects/workspace-description";
import { AddPicker } from "@/components/projects/workspace-panels";
import { UpdatesSection } from "@/components/projects/project-updates";
import {
  HEALTH_META,
  PROJECT_STATUS_META,
  projectHealth,
} from "@/components/projects/tracking/tracking-shared";
import {
  archiveInitiative,
  linkInitiativeProject,
  unlinkInitiativeProject,
  updateInitiative,
} from "./actions";
import { HealthDot } from "./health";
import { INITIATIVE_STATUS_META, INITIATIVE_STATUSES } from "./initiative-status";
import { useInitiativeRollups } from "./use-initiative-rollups";
import { useInitiativesRealtime } from "./use-initiatives-realtime";

type Person = { id: string; name: string | null; avatarUrl: string | null };

/**
 * One initiative's workspace — the project page's chrome (`WorkspaceShell`)
 * over Linear's initiative overview: editable name + description, the updates
 * composer/feed, linked projects with progress + health (add / remove), and
 * a properties rail (status, health, owner, lead team, target).
 */
export function InitiativeDetail({
  propertyId,
  initiativeId,
}: {
  propertyId: string;
  initiativeId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: initiative, isPending } = useQuery(initiativeQueryOptions(initiativeId));
  const { rollups, projects: allProjects } = useInitiativeRollups(propertyId);
  useInitiativesRealtime(propertyId);
  const { data: people = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const meId = useViewerId();
  const lookup = useActivityLookup(propertyId, meId);
  useActivityLogRealtime(propertyId);
  const { data: activity = [], isPending: activityPending } = useQuery(
    activityLogQueryOptions(propertyId, { kind: "entity", id: initiativeId }, 30),
  );

  // The list rollup carries the joined projects + health; an archived
  // initiative isn't in the list, so fall back to its own link ids.
  const rollup = rollups.find((r) => r.initiative.id === initiativeId);
  const linkedProjects = useMemo(() => {
    if (rollup) return rollup.projects;
    const ids = new Set(initiative?.projectIds ?? []);
    return allProjects
      .filter((p) => ids.has(p.id))
      .map((p) => ({ ...p, declared: null, effective: null }));
  }, [rollup, initiative?.projectIds, allProjects]);
  const candidates = useMemo(() => {
    const linked = new Set(initiative?.projectIds ?? []);
    return allProjects
      .filter((p) => !linked.has(p.id))
      .map((p) => ({ id: p.id, title: p.name }));
  }, [allProjects, initiative?.projectIds]);
  const done = linkedProjects.reduce((n, p) => n + p.done, 0);
  const total = linkedProjects.reduce((n, p) => n + p.total, 0);

  const [name, setName] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initiative) setName(initiative.name);
  }, [initiative]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["initiative", initiativeId] });
    void qc.invalidateQueries({ queryKey: ["initiatives", propertyId] });
  }
  async function patch(p: Parameters<typeof updateInitiative>[1]) {
    const res = await updateInitiative(initiativeId, p);
    if ("error" in res) toast.error(res.error);
    refresh();
    return res;
  }
  async function commitName() {
    const next = name.trim();
    if (!initiative || !next || next === initiative.name) {
      if (initiative) setName(initiative.name);
      return;
    }
    await patch({ name: next });
  }
  async function commitDescription(description: string | null) {
    const res = await patch({ description });
    return "error" in res ? { error: res.error } : {};
  }
  async function addProject(projectId: string) {
    const res = await linkInitiativeProject(initiativeId, projectId);
    if ("error" in res) toast.error(res.error);
    refresh();
  }
  async function removeProject(projectId: string) {
    const res = await unlinkInitiativeProject(initiativeId, projectId);
    if ("error" in res) toast.error(res.error);
    refresh();
  }
  async function toggleArchive() {
    const archived = Boolean(initiative?.archived_at);
    if (!archived && !window.confirm("Archive this initiative? Its projects stay as they are."))
      return;
    const res = await archiveInitiative(initiativeId, !archived);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    refresh();
    if (!archived) router.push(`/p/${propertyId}/initiatives`);
  }

  if (isPending)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading initiative…
      </div>
    );
  if (!initiative)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">Initiative not found.</p>
        <Link
          href={`/p/${propertyId}/initiatives`}
          className="text-sm text-foreground underline underline-offset-4"
        >
          Back to initiatives
        </Link>
      </div>
    );

  const health = rollup?.health ?? { health: null, source: "none" as const };
  const healthSuffix = health.source === "rollup" ? " (from projects)" : undefined;
  const target = formatTarget(initiative.target_date);

  const breadcrumb = (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link
        href={`/p/${propertyId}/initiatives`}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        Initiatives
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 items-center gap-1.5 truncate text-foreground">
        {initiative.icon ? (
          <span className="shrink-0 text-sm leading-none">{initiative.icon}</span>
        ) : (
          <span
            className={cn("size-2 shrink-0 rounded-full", LABEL_DOT[initiative.color])}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{initiative.name}</span>
      </span>
    </nav>
  );

  const header = (
    <div className="flex flex-col gap-4">
      {initiative.archived_at ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          This initiative is archived.
        </p>
      ) : null}
      <div className="flex min-w-0 items-center gap-2.5">
        {initiative.icon ? (
          <span className="shrink-0 text-2xl leading-none">{initiative.icon}</span>
        ) : (
          <span
            className={cn("size-3 shrink-0 rounded-md", LABEL_DOT[initiative.color])}
            aria-hidden="true"
          />
        )}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setName(initiative.name);
              e.currentTarget.blur();
            }
          }}
          aria-label="Initiative name"
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground",
            ws.title,
          )}
          placeholder="Untitled initiative"
        />
      </div>
      <div className="pb-3">
        <WorkspaceDescription value={initiative.description} onSave={commitDescription} />
      </div>
      <MetadataRow>
        <MetadataItem label="Status">
          <StatusMenu
            status={initiative.status}
            onSelect={(status) => void patch({ status })}
            inline
          />
        </MetadataItem>
        <MetadataItem label="Health">
          <HealthDot health={health.health} suffix={healthSuffix} />
        </MetadataItem>
        <MetadataItem label="Projects">
          <span className="tabular-nums">{linkedProjects.length}</span>
        </MetadataItem>
        {target ? (
          <MetadataItem label="Target">
            <span className="tabular-nums">{target}</span>
          </MetadataItem>
        ) : null}
      </MetadataRow>
    </div>
  );

  const projectsSection = (
    <OverviewSection
      title="Projects"
      action={
        <AddPicker label="Add project" candidates={candidates} onAdd={(id) => void addProject(id)} />
      }
    >
      {linkedProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No projects yet — add the projects that move this initiative forward.
        </p>
      ) : (
        <ul role="list" className="flex flex-col">
          {linkedProjects.map((p) => {
            const status = PROJECT_STATUS_META[p.status];
            const computed = HEALTH_META[projectHealth(p)];
            const progress = pct(p.done, p.total);
            return (
              <li key={p.id} className="group/row relative border-t border-border first:border-0">
                <Link
                  href={`/p/${propertyId}/projects/${p.id}`}
                  className="flex min-h-[44px] items-center gap-3 rounded-md py-1.5 pr-9 pl-0.5 transition-colors hover:bg-accent"
                >
                  {p.icon ? (
                    <span className="w-3 shrink-0 text-center text-sm leading-none">{p.icon}</span>
                  ) : (
                    <span
                      className={cn("size-1.5 shrink-0 rounded-full", LABEL_DOT[p.color])}
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {p.name || "Untitled project"}
                  </span>
                  <span className="hidden w-24 shrink-0 items-center gap-1.5 text-sm text-muted-foreground sm:flex">
                    <span className={cn("size-1.5 rounded-full", status.dot)} aria-hidden="true" />
                    {status.label}
                  </span>
                  <span className="w-28 shrink-0">
                    {p.declared ? (
                      <HealthDot health={p.declared} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span className={cn("size-2 rounded-full", computed.dot)} aria-hidden="true" />
                        {computed.label}
                      </span>
                    )}
                  </span>
                  <span className="flex w-28 shrink-0 items-center gap-2 sm:w-36">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      {p.total > 0 ? (
                        <span
                          className="block h-full rounded-full bg-success/90"
                          style={{ width: `${progress}%` }}
                        />
                      ) : null}
                    </span>
                    <span className="w-8 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {progress}%
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label={`Remove ${p.name} from this initiative`}
                  title="Remove from initiative"
                  onClick={() => void removeProject(p.id)}
                  className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-accent hover:text-destructive focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewSection>
  );

  const tabs: WorkspaceTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="flex flex-col gap-10">
          <UpdatesSection propertyId={propertyId} target={{ kind: "initiative", id: initiativeId }} />
          {projectsSection}
        </div>
      ),
    },
    {
      id: "activity",
      label: "Activity",
      content: (
        <ActivityLogFeed
          propertyId={propertyId}
          scope={{ kind: "entity", id: initiativeId }}
          meId={meId}
          showProject={false}
        />
      ),
    },
  ];

  const rightRail = (
    <div className="flex flex-col">
      <RailGroup label="Properties">
        <PropertyRow label="Status">
          <StatusMenu status={initiative.status} onSelect={(status) => void patch({ status })} />
        </PropertyRow>
        <PropertyRow label="Health">
          <span className="px-1.5 py-1">
            <HealthDot health={health.health} suffix={healthSuffix} />
          </span>
        </PropertyRow>
        <PropertyRow label="Owner">
          <PersonPicker
            people={people}
            value={initiative.owner_id}
            emptyLabel="No owner"
            clearLabel="Clear owner"
            onSelect={(owner_id) => void patch({ owner_id })}
          />
        </PropertyRow>
        <PropertyRow label="Lead team">
          <DropdownMenu>
            <DropdownMenuTrigger render={<button type="button" className={railValueClass} />}>
              {(() => {
                const team = spaces.find((s) => s.id === initiative.lead_space_id);
                return team ? (
                  <>
                    <span className={cn("size-1.5 shrink-0 rounded-full", LABEL_DOT[team.color])} />
                    <span className="truncate">{team.name}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No team</span>
                );
              })()}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="max-h-72 overflow-y-auto">
              {spaces.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => void patch({ lead_space_id: s.id })}>
                  <span className={cn("size-2 rounded-full", LABEL_DOT[s.color])} />
                  <span className="flex-1 truncate">{s.name}</span>
                  {s.id === initiative.lead_space_id ? <Check className="size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
              {initiative.lead_space_id ? (
                <DropdownMenuItem onClick={() => void patch({ lead_space_id: null })}>
                  <span className="flex-1 text-muted-foreground">Clear team</span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </PropertyRow>
        <PropertyRow label="Target">
          <span className="flex items-center gap-1.5">
            <TargetDateInput
              key={initiative.target_date ?? ""}
              value={initiative.target_date}
              onCommit={(target_date) => void patch({ target_date })}
            />
            {target ? <span className="text-sm text-faint-foreground">{target}</span> : null}
          </span>
        </PropertyRow>
        <PropertyRow label="Created">
          <span className="px-1.5 py-1">
            <RailDate value={initiative.created_at} />
          </span>
        </PropertyRow>
      </RailGroup>

      <RailGroup label="Progress">
        <RailProgress done={done} total={total} />
        <p className="px-0.5 pt-1 text-xs text-faint-foreground">
          Issues done across {linkedProjects.length}{" "}
          {linkedProjects.length === 1 ? "project" : "projects"}
        </p>
      </RailGroup>

      <RailGroup label="Activity">
        <ActivityLogList rows={activity.slice(0, 6)} lookup={lookup} pending={activityPending} dense />
      </RailGroup>
    </div>
  );

  const overflow = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" size="icon-sm" variant="ghost" title="More" />}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem onClick={() => void toggleArchive()}>
          {initiative.archived_at ? (
            <RotateCcw className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
          <span className="flex-1">
            {initiative.archived_at ? "Restore initiative" : "Archive initiative"}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <WorkspaceShell
      breadcrumb={breadcrumb}
      header={header}
      headerActions={overflow}
      tabs={tabs}
      rightRail={rightRail}
    />
  );
}

/**
 * Commit on blur / Enter, not per change — a date input fires a change for
 * every typed segment, and each commit would log an activity row.
 */
function TargetDateInput({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const commit = () => {
    const next = draft || null;
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      aria-label="Target date"
      className="h-7 w-[9.5rem] text-sm"
    />
  );
}

function StatusMenu({
  status,
  onSelect,
  inline,
}: {
  status: InitiativeStatus;
  onSelect: (s: InitiativeStatus) => void;
  inline?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={inline ? "inline-flex items-center gap-1.5" : railValueClass}
          />
        }
      >
        <span className={cn("size-2 shrink-0 rounded-full", INITIATIVE_STATUS_META[status].dot)} />
        {INITIATIVE_STATUS_META[status].label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        {INITIATIVE_STATUSES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onSelect(s)}>
            <span className={cn("size-2 rounded-full", INITIATIVE_STATUS_META[s].dot)} />
            <span className="flex-1">{INITIATIVE_STATUS_META[s].label}</span>
            {s === status ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PersonPicker({
  people,
  value,
  emptyLabel,
  clearLabel,
  onSelect,
}: {
  people: Person[];
  value: string | null;
  emptyLabel: string;
  clearLabel: string;
  onSelect: (id: string | null) => void;
}) {
  const current = value ? people.find((p) => p.id === value) : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={railValueClass} />}>
        {current ? (
          <>
            <Avatar className="size-4">
              {current.avatarUrl ? <AvatarImage src={current.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-[9px]">
                {(current.name ?? "?").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{current.name ?? "Member"}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{emptyLabel}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="max-h-72 overflow-y-auto">
        {people.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onSelect(p.id)}>
            <Avatar className="size-4">
              {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-[9px]">
                {(p.name ?? "?").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate">{p.name ?? "Member"}</span>
            {p.id === value ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        {value ? (
          <DropdownMenuItem onClick={() => onSelect(null)}>
            <span className="flex-1 text-muted-foreground">{clearLabel}</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
