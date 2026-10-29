"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Archive,
  Check,
  FolderKanban,
  LayoutGrid,
  MoreHorizontal,
  RotateCcw,
  Target,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Gi } from "@/components/gr8r/icon";
import { Av, G8_COLOR, PStatus, ProgBar } from "@/components/gr8r/home-glyphs";
import { G8Empty, FeedItem } from "@/components/gr8r/members-shared";
import {
  G8Panel,
  PROJECT_STATUS,
  ProjectIcon,
  ProjectPageShell,
  fmtDay,
  type CSSVars,
  type ProjectTabDef,
} from "@/components/gr8r/project-page";
import { KV_ICONS, KvRow } from "@/components/gr8r/project-overview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InitiativeStatus } from "@/lib/db/types";
import { initiativeQueryOptions } from "@/lib/query/initiative-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import { activityLogQueryOptions } from "@/lib/query/activity-log-queries";
import { formatTarget, pct } from "@/lib/initiatives/planning";
import {
  ActivityLogFeed,
  useActivityLogRealtime,
  useActivityLookup,
  useViewerId,
} from "@/components/activity/activity-log";
import { useUrlTab } from "@/components/projects/workspace-shell";
import { WorkspaceDescription } from "@/components/projects/workspace-description";
import { AddPicker } from "@/components/projects/workspace-panels";
import { UpdatesSection } from "@/components/projects/project-updates";
import {
  HEALTH_META,
  projectHealth,
} from "@/components/projects/tracking/tracking-shared";
import {
  archiveInitiative,
  linkInitiativeProject,
  unlinkInitiativeProject,
  updateInitiative,
} from "./actions";
import { HealthDot, UpdateHealthBadge } from "./health";
import { INITIATIVE_STATUS_META, INITIATIVE_STATUSES } from "./initiative-status";
import { useInitiativeRollups } from "./use-initiative-rollups";
import { useInitiativesRealtime } from "./use-initiatives-realtime";

type Person = { id: string; name: string | null; avatarUrl: string | null };

/**
 * One initiative's workspace — gr8r's project page chrome
 * (`ProjectPageShell`: `.proj-h` title row + `.tabs`) over Linear's
 * initiative overview in gr8r's `.grid2` of panels: About (editable
 * description), Updates (composer + feed), linked Projects with progress +
 * health (add / remove) on the left; Details (`dl.kv`: status, health,
 * owner, lead team, target, created), Progress and Recent activity on the
 * right. The Activity tab is the full filtered feed.
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

  const [tab, setTab] = useUrlTab("overview");
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
      <div className="fullstate">
        <span className="faint">Loading initiative…</span>
      </div>
    );
  if (!initiative)
    return (
      <div className="fullstate">
        <div className="box">
          <G8Empty icon={Target} title="Initiative not found" text="It may have been archived or removed.">
            <Link href={`/p/${propertyId}/initiatives`} className="btn btn-secondary btn-sm">
              Back to initiatives
            </Link>
          </G8Empty>
        </div>
      </div>
    );

  const health = rollup?.health ?? { health: null, source: "none" as const };
  const healthSuffix = health.source === "rollup" ? " (from projects)" : undefined;
  const target = formatTarget(initiative.target_date);

  const tabsDef: ProjectTabDef[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "activity", label: "Activity", icon: Activity },
  ];
  const progressPct = total ? Math.round((done / total) * 100) : 0;

  const projectsPanel = (
    <G8Panel
      title="Projects"
      count={linkedProjects.length}
      flush
      acts={
        <AddPicker label="Add project" candidates={candidates} onAdd={(id) => void addProject(id)} />
      }
    >
      {linkedProjects.length === 0 ? (
        <G8Empty
          icon={FolderKanban}
          title="No projects yet"
          text="Add the projects that move this initiative forward."
          sm
        />
      ) : (
        <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {linkedProjects.map((p) => {
            const status = PROJECT_STATUS[p.status];
            const computed = HEALTH_META[projectHealth(p)];
            const progress = pct(p.done, p.total);
            return (
              <li key={p.id} className="group/row relative">
                <Link
                  href={`/p/${propertyId}/projects/${p.id}`}
                  className="mini"
                  style={{ paddingRight: 40, minHeight: 44 }}
                >
                  <ProjectIcon icon={p.icon} color={p.color} />
                  <span className="tt" style={{ fontWeight: 500 }}>
                    {p.name || "Untitled project"}
                  </span>
                  <span className="hidden sm:inline-flex" style={{ width: 104, flexShrink: 0 }}>
                    <PStatus name={status.name} color={status.c} />
                  </span>
                  <span style={{ width: 112, flexShrink: 0, fontSize: "var(--g8-fs-sm)" }}>
                    {p.declared ? (
                      <HealthDot health={p.declared} />
                    ) : (
                      <span className="muted">{computed.label}</span>
                    )}
                  </span>
                  <span className="row" style={{ width: 128, flexShrink: 0, gap: 8 }}>
                    <ProgBar value={progress} tone="green" />
                    <span className="faint num" style={{ width: 32, textAlign: "right", fontSize: "var(--g8-fs-xs)" }}>
                      {progress}%
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label={`Remove ${p.name} from this initiative`}
                  title="Remove from initiative"
                  onClick={() => void removeProject(p.id)}
                  className="ibtn ibtn-sm absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                >
                  <Gi icon={X} size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </G8Panel>
  );

  const details = (
    <dl className="kv">
      <KvRow icon={KV_ICONS.status} label="Status">
        <StatusMenu status={initiative.status} onSelect={(status) => void patch({ status })} />
      </KvRow>
      <KvRow icon={KV_ICONS.health} label="Health">
        <span className="pillbtn" style={{ cursor: "default" }}>
          <HealthDot health={health.health} suffix={healthSuffix} />
        </span>
      </KvRow>
      <KvRow icon={KV_ICONS.lead} label="Owner">
        <PersonPicker
          people={people}
          value={initiative.owner_id}
          emptyLabel="No owner"
          clearLabel="Clear owner"
          onSelect={(owner_id) => void patch({ owner_id })}
        />
      </KvRow>
      <KvRow icon={KV_ICONS.team} label="Lead team">
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className="pillbtn" />}>
            {(() => {
              const team = spaces.find((s) => s.id === initiative.lead_space_id);
              return team ? (
                <>
                  <span className="pdot" style={{ "--g8-c": G8_COLOR[team.color], borderRadius: "50%" } as CSSVars} />
                  <span className="trunc">{team.name}</span>
                </>
              ) : (
                <span className="faint">No team</span>
              );
            })()}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className="max-h-72 overflow-y-auto">
            {spaces.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => void patch({ lead_space_id: s.id })}>
                <span className="size-2 rounded-full" style={{ background: G8_COLOR[s.color] }} />
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
      </KvRow>
      <KvRow icon={KV_ICONS.due} label="Target">
        <span className="row" style={{ gap: 6 }}>
          <TargetDateInput
            key={initiative.target_date ?? ""}
            value={initiative.target_date}
            onCommit={(target_date) => void patch({ target_date })}
          />
          {target ? <span className="faint num">{target}</span> : null}
        </span>
      </KvRow>
      <KvRow icon={KV_ICONS.created} label="Created">
        <span className="pillbtn" style={{ cursor: "default" }}>
          {fmtDay(initiative.created_at) ?? "—"}
        </span>
      </KvRow>
    </dl>
  );

  const overview = (
    <div className="page" style={{ maxWidth: 1160, paddingTop: 22, width: "100%" }}>
      {initiative.archived_at ? (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <Gi icon={Archive} size={14} />
          <span>This initiative is archived.</span>
        </div>
      ) : null}
      <div className="grid2">
        <div className="stack">
          <G8Panel title="About">
            <WorkspaceDescription value={initiative.description} onSave={commitDescription} />
          </G8Panel>
          <UpdatesSection
            propertyId={propertyId}
            target={{ kind: "initiative", id: initiativeId }}
            variant="panel"
          />
          {projectsPanel}
        </div>
        <div className="stack" style={{ alignSelf: "start" }}>
          <G8Panel title="Details">{details}</G8Panel>
          <G8Panel title="Progress" count={`${progressPct}%`}>
            <div className="row" style={{ gap: 10 }}>
              <ProgBar value={progressPct} tone="green" />
              <span className="muted num" style={{ fontSize: "var(--g8-fs-sm)", flexShrink: 0 }}>
                {done}/{total}
              </span>
            </div>
            <p className="faint" style={{ margin: "8px 0 0", fontSize: "var(--g8-fs-xs)" }}>
              Issues done across {linkedProjects.length}{" "}
              {linkedProjects.length === 1 ? "project" : "projects"}
            </p>
          </G8Panel>
          <G8Panel
            title="Recent activity"
            acts={
              activity.length ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTab("activity")}>
                  View all
                </button>
              ) : null
            }
          >
            <div className="feed">
              {activityPending ? (
                <span className="faint">Loading…</span>
              ) : activity.length ? (
                activity.slice(0, 6).map((a) => <FeedItem key={a.id} row={a} lookup={lookup} />)
              ) : (
                <span className="faint">No activity yet</span>
              )}
            </div>
          </G8Panel>
        </div>
      </div>
    </div>
  );

  const overflow = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className="ibtn" title="More" aria-label="More" />}
      >
        <Gi icon={MoreHorizontal} size={15} />
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
    <ProjectPageShell
      crumbs={[
        { label: "Initiatives", href: `/p/${propertyId}/initiatives`, icon: <Target /> },
        { label: initiative.name || "Untitled initiative" },
      ]}
      icon={
        <span className="picon lg" style={{ "--g8-c": G8_COLOR[initiative.color] } as CSSVars}>
          {initiative.icon ? (
            <span style={{ fontSize: 18, lineHeight: 1 }}>{initiative.icon}</span>
          ) : (
            <Gi icon={Target} size={18} />
          )}
        </span>
      }
      title={
        <h1 style={{ minWidth: 0, flex: "0 1 auto" }}>
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
            placeholder="Untitled initiative"
            size={Math.max(8, Math.min(48, name.length + 1))}
            className="proj-name-in"
          />
        </h1>
      }
      status={
        <span className="row" style={{ gap: 8 }}>
          <StatusMenu status={initiative.status} onSelect={(status) => void patch({ status })} />
          {health.health ? <UpdateHealthBadge health={health.health} /> : null}
        </span>
      }
      headActions={overflow}
      tabs={tabsDef}
      active={tab}
      onTab={setTab}
    >
      {tab === "activity" ? (
        <div className="page" style={{ maxWidth: 900, paddingTop: 22, width: "100%" }}>
          <ActivityLogFeed
            propertyId={propertyId}
            scope={{ kind: "entity", id: initiativeId }}
            meId={meId}
            showProject={false}
          />
        </div>
      ) : (
        overview
      )}
    </ProjectPageShell>
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
      className="input"
      style={{ height: 26, width: 148, fontSize: "var(--g8-fs-sm)" }}
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
        render={<button type="button" className={inline ? "pillbtn" : "pillbtn"} />}
      >
        <PStatus
          name={INITIATIVE_STATUS_META[status].label}
          color={INITIATIVE_STATUS_META[status].c}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        {INITIATIVE_STATUSES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onSelect(s)}>
            <span className="size-2 rounded-full" style={{ background: INITIATIVE_STATUS_META[s].c }} />
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
      <DropdownMenuTrigger render={<button type="button" className="pillbtn" />}>
        {current ? (
          <>
            <Av member={current} />
            <span className="trunc">{current.name ?? "Member"}</span>
          </>
        ) : (
          <span className="faint">{emptyLabel}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="max-h-72 overflow-y-auto">
        {people.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onSelect(p.id)}>
            <Av member={p} />
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
