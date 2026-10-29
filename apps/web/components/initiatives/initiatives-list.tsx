"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { Av, G8_COLOR } from "@/components/gr8r/home-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import { formatTarget } from "@/lib/initiatives/planning";
import { HealthDot } from "./health";
import { CreateInitiativeDialog } from "./create-initiative-dialog";
import { useInitiativeRollups } from "./use-initiative-rollups";
import { useInitiativesRealtime } from "./use-initiatives-realtime";
import { useProjectUpdatesRealtime } from "@/components/projects/project-updates";

type Tab = "active" | "planned" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "planned", label: "Planned" },
  { id: "all", label: "All" },
];

const COLS = {
  name: "min-w-0 flex-1",
  owner: "hidden w-36 shrink-0 md:flex",
  team: "hidden w-32 shrink-0 lg:flex",
  target: "w-20 shrink-0",
  projects: "hidden w-16 shrink-0 sm:flex",
  health: "w-28 shrink-0",
  active: "hidden w-24 shrink-0 lg:flex",
};

/**
 * Linear's Initiatives list: Active / Planned / All, one row per initiative
 * with Owner, Lead team, Target ("Q2 2027"), project count, Health and active
 * project count. Health is the initiative's own latest update when it has one,
 * else the worst health across its open projects (marked "roll-up").
 */
export function InitiativesList({ propertyId }: { propertyId: string }) {
  const { rollups, isPending } = useInitiativeRollups(propertyId);
  useInitiativesRealtime(propertyId);
  useProjectUpdatesRealtime(propertyId);
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);
  const [tab, setTab] = useState<Tab>("active");
  const [createOpen, setCreateOpen] = useState(false);

  const shown = useMemo(
    () => (tab === "all" ? rollups : rollups.filter((r) => r.initiative.status === tab)),
    [rollups, tab],
  );

  const newButton = (cls: string) => (
    <button type="button" className={cls} onClick={() => setCreateOpen(true)}>
      <Gi icon={Plus} size={14} />
      New initiative
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader title="Initiatives" icon={<Target />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide" style={{ maxWidth: 1240 }}>
          <div className="ph">
            <div>
              <h1>Initiatives</h1>
              <p>
                Property-wide goals that group projects —{" "}
                {shown.length} {shown.length === 1 ? "initiative" : "initiatives"}
                {tab === "all" ? "" : ` ${tab}`}
              </p>
            </div>
            <div className="acts">{newButton("btn btn-primary")}</div>
          </div>
          <div className="tabs" role="tablist" aria-label="Initiative status" style={{ marginBottom: 14 }}>
            {TABS.map((t) => {
              const n =
                t.id === "all"
                  ? rollups.length
                  : rollups.filter((r) => r.initiative.status === t.id).length;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? "tab on" : "tab"}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {n ? <span className="cnt">{n}</span> : null}
                </button>
              );
            })}
          </div>

          {isPending ? (
            <div className="panel">
              <div className="panel-b" style={{ paddingTop: 14 }}>
                <span className="faint">Loading initiatives…</span>
              </div>
            </div>
          ) : shown.length === 0 ? (
            <div className="panel">
              <G8Empty
                icon={Target}
                title={rollups.length === 0 ? "No initiatives yet" : `No ${tab} initiatives`}
                text={
                  rollups.length === 0
                    ? "Group projects under a property-wide goal — a room refresh, a season opening — and track them together."
                    : "Switch tabs to see the rest."
                }
              >
                {rollups.length === 0 ? newButton("btn btn-secondary btn-sm") : null}
              </G8Empty>
            </div>
          ) : (
            <div className="panel" style={{ overflow: "hidden" }}>
              <div className="thead" style={{ display: "flex", gap: 12, padding: "0 6px" }}>
                <div className={COLS.name}>Name</div>
                <div className={COLS.owner}>Owner</div>
                <div className={COLS.team}>Lead team</div>
                <div className={COLS.target}>Target</div>
                <div className={COLS.projects} style={{ justifyContent: "flex-end" }}>Projects</div>
                <div className={COLS.health}>Health</div>
                <div className={COLS.active} style={{ justifyContent: "flex-end" }}>Active</div>
              </div>
              <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {shown.map(({ initiative: i, projects, health, activeProjects }) => {
                  const owner = i.owner_id ? memberById.get(i.owner_id) : undefined;
                  const team = i.lead_space_id ? spaceById.get(i.lead_space_id) : undefined;
                  return (
                    <li key={i.id}>
                      <Link
                        href={`/p/${propertyId}/initiatives/${i.id}`}
                        className="trow focus-visible:outline-none focus-visible:bg-(--g8-surface-2)"
                        style={{ display: "flex", gap: 12, padding: "6px", minHeight: 48 }}
                      >
                        <div className={cn(COLS.name)} style={{ gap: 10 }}>
                          {i.icon ? (
                            <span className="w-4 shrink-0 text-center leading-none">{i.icon}</span>
                          ) : (
                            <span
                              className="pdot"
                              style={{ "--g8-c": G8_COLOR[i.color], marginLeft: 4 } as CSSVars}
                              aria-hidden="true"
                            />
                          )}
                          <span className="col" style={{ minWidth: 0 }}>
                            <span className="trunc" style={{ fontWeight: 500 }}>
                              {i.name}
                            </span>
                            {i.description ? (
                              <span className="trunc faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
                                {i.description.split("\n")[0]}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <div className={COLS.owner}>
                          {owner ? (
                            <>
                              <Av
                                member={{ id: owner.id, name: owner.name, avatarUrl: owner.avatarUrl }}
                              />
                              <span className="trunc">{owner.name ?? "Member"}</span>
                            </>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </div>
                        <div className={COLS.team}>
                          {team ? (
                            <>
                              <span
                                className="pdot"
                                style={{ "--g8-c": G8_COLOR[team.color] } as CSSVars}
                              />
                              <span className="trunc">{team.name}</span>
                            </>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </div>
                        <div className={cn(COLS.target, "num muted")}>
                          {formatTarget(i.target_date) ?? "—"}
                        </div>
                        <div
                          className={cn(COLS.projects, "num muted")}
                          style={{ justifyContent: "flex-end" }}
                        >
                          {projects.length}
                        </div>
                        <div
                          className={COLS.health}
                          title={
                            health.source === "rollup"
                              ? "No initiative update yet — rolled up from its projects"
                              : health.source === "declared"
                                ? "From the latest initiative update"
                                : undefined
                          }
                        >
                          <HealthDot health={health.health} />
                        </div>
                        <div
                          className={cn(COLS.active, "num muted")}
                          style={{ justifyContent: "flex-end" }}
                        >
                          {activeProjects}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      <CreateInitiativeDialog open={createOpen} onOpenChange={setCreateOpen} propertyId={propertyId} />
    </div>
  );
}

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;
