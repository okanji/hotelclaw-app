"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader, PageHeaderRow } from "@/components/shell/page-header";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LABEL_DOT } from "@/components/labels/label-tokens";
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
  owner: "hidden w-36 shrink-0 md:block",
  team: "hidden w-32 shrink-0 lg:block",
  target: "w-20 shrink-0",
  projects: "hidden w-16 shrink-0 text-right sm:block",
  health: "w-28 shrink-0",
  active: "hidden w-24 shrink-0 text-right lg:block",
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

  return (
    <PageShell width="bleed" className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Initiatives"
        icon={<Target />}
        actions={
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New initiative
          </Button>
        }
      />
      <PageHeaderRow
        aside={
          <>
            {shown.length} {shown.length === 1 ? "initiative" : "initiatives"}
          </>
        }
      >
        <TabNav variant="pill" aria-label="Initiative status">
          {TABS.map((t) => (
            <TabNavItem key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </TabNavItem>
          ))}
        </TabNav>
      </PageHeaderRow>

      <div className="min-h-0 flex-1 overflow-y-auto px-(--page-gutter) pb-2">
        {isPending ? (
          <p className="pt-8 text-sm text-muted-foreground">Loading initiatives…</p>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={Target}
            title={rollups.length === 0 ? "No initiatives yet" : `No ${tab} initiatives`}
            className="mt-8"
            action={
              rollups.length === 0 ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  New initiative
                </Button>
              ) : undefined
            }
          >
            {rollups.length === 0
              ? "Group projects under a property-wide goal — a room refresh, a season opening — and track them together."
              : "Switch tabs to see the rest."}
          </EmptyState>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex h-9 items-center gap-3 border-b border-border bg-background text-sm/[1.2] text-muted-foreground">
              <div className={COLS.name}>Name</div>
              <div className={COLS.owner}>Owner</div>
              <div className={COLS.team}>Lead team</div>
              <div className={COLS.target}>Target</div>
              <div className={COLS.projects}>Projects</div>
              <div className={COLS.health}>Health</div>
              <div className={COLS.active}>Active</div>
            </div>
            <ul role="list" className="divide-y divide-border">
              {shown.map(({ initiative: i, projects, health, activeProjects }) => {
                const owner = i.owner_id ? memberById.get(i.owner_id) : undefined;
                const team = i.lead_space_id ? spaceById.get(i.lead_space_id) : undefined;
                return (
                  <li key={i.id}>
                    <Link
                      href={`/p/${propertyId}/initiatives/${i.id}`}
                      className="flex min-h-[44px] items-center gap-3 rounded-md py-1.5 text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <div className={cn(COLS.name, "flex items-center gap-2.5")}>
                        {i.icon ? (
                          <span className="w-4 shrink-0 text-center leading-none">{i.icon}</span>
                        ) : (
                          <span
                            className={cn("ml-1 size-2 shrink-0 rounded-full", LABEL_DOT[i.color])}
                            aria-hidden="true"
                          />
                        )}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-foreground">{i.name}</span>
                          {i.description ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {i.description.split("\n")[0]}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className={COLS.owner}>
                        {owner ? (
                          <span className="inline-flex max-w-full items-center gap-1.5 text-foreground">
                            <Avatar className="size-4">
                              {owner.avatarUrl ? <AvatarImage src={owner.avatarUrl} alt="" /> : null}
                              <AvatarFallback className="text-[9px]">
                                {(owner.name ?? "?").slice(0, 1).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate">{owner.name ?? "Member"}</span>
                          </span>
                        ) : (
                          <span className="text-faint-foreground">—</span>
                        )}
                      </div>
                      <div className={COLS.team}>
                        {team ? (
                          <span className="inline-flex max-w-full items-center gap-1.5 text-foreground">
                            <span className={cn("size-1.5 shrink-0 rounded-full", LABEL_DOT[team.color])} />
                            <span className="truncate">{team.name}</span>
                          </span>
                        ) : (
                          <span className="text-faint-foreground">—</span>
                        )}
                      </div>
                      <div className={cn(COLS.target, "tabular-nums text-muted-foreground")}>
                        {formatTarget(i.target_date) ?? "—"}
                      </div>
                      <div className={cn(COLS.projects, "tabular-nums text-muted-foreground")}>
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
                      <div className={cn(COLS.active, "tabular-nums text-muted-foreground")}>
                        {activeProjects}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <CreateInitiativeDialog open={createOpen} onOpenChange={setCreateOpen} propertyId={propertyId} />
    </PageShell>
  );
}
