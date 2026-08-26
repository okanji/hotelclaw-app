"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  Circle,
  Hash,
  ListFilter,
  Plus,
  User,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import type { EntityColor, ProjectStatus } from "@/lib/db/types";
import type { ProjectTracking } from "@/lib/query/project-queries";
import {
  NONE,
  summaryFor,
  ValuePicker,
  type Option,
} from "@/components/tasks/board-filters";
import {
  PROJECT_STATUS_META,
  STATUS_ORDER,
  type ProjectMember,
} from "./tracking/tracking-shared";

/* -------------------------------------------------------------------------- */
/* Filter model                                                               */
/*                                                                            */
/* The projects index's Linear-style filter state: additive facets surfaced   */
/* as removable chips, AND across facets / OR within one — the same model as  */
/* the tasks board (`board-filters.tsx`), whose picker + chip primitives      */
/* this file reuses so the two surfaces never drift visually.                 */
/* -------------------------------------------------------------------------- */

/** Buckets for the Target-date facet, evaluated against `target_date`. */
export type TargetBucket = "overdue" | "month" | "quarter" | "none";

export type ProjectFacetKey = "status" | "team" | "member" | "target";

export type ProjectsFilters = {
  statuses: ProjectStatus[];
  /** Team (space) ids; `NONE` sentinel = no team involved. */
  spaceIds: string[];
  /** Members with tasks in the project (contributors). */
  memberIds: string[];
  target: TargetBucket[];
};

export const EMPTY_PROJECT_FILTERS: ProjectsFilters = {
  statuses: [],
  spaceIds: [],
  memberIds: [],
  target: [],
};

const FACET_ORDER: ProjectFacetKey[] = ["status", "team", "member", "target"];

const FACET_FIELD: Record<ProjectFacetKey, keyof ProjectsFilters> = {
  status: "statuses",
  team: "spaceIds",
  member: "memberIds",
  target: "target",
};

const FACET_META: Record<
  ProjectFacetKey,
  { label: string; Icon: typeof User; searchable: boolean }
> = {
  status: { label: "Status", Icon: Circle, searchable: false },
  team: { label: "Team", Icon: Hash, searchable: true },
  member: { label: "Member", Icon: User, searchable: true },
  target: { label: "Target date", Icon: CalendarClock, searchable: false },
};

const TARGET_LABELS: Record<TargetBucket, string> = {
  overdue: "Overdue",
  month: "This month",
  quarter: "This quarter",
  none: "No target date",
};

export function activeProjectFacetCount(filters: ProjectsFilters): number {
  return FACET_ORDER.reduce(
    (n, f) => n + ((filters[FACET_FIELD[f]] as string[]).length > 0 ? 1 : 0),
    0,
  );
}

export function hasAnyProjectFacet(filters: ProjectsFilters): boolean {
  return activeProjectFacetCount(filters) > 0;
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

/** Which target-buckets a project falls into, relative to `now`. */
function projectTargetBuckets(project: ProjectTracking, now: number): TargetBucket[] {
  if (!project.target_date) return ["none"];
  const t = Date.parse(project.target_date);
  if (Number.isNaN(t)) return ["none"];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startToday = start.getTime();
  const endMonth = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
  const quarterStartMonth = Math.floor(start.getMonth() / 3) * 3;
  const endQuarter = new Date(start.getFullYear(), quarterStartMonth + 3, 1).getTime();
  const out: TargetBucket[] = [];
  const open = project.status === "planned" || project.status === "active";
  if (t < startToday && open) out.push("overdue");
  if (t >= startToday && t < endMonth) out.push("month");
  if (t >= startToday && t < endQuarter) out.push("quarter");
  return out;
}

/**
 * AND across facets, OR within a facet — same semantics as the tasks board.
 * `spaceIdsByProject` maps project id → involved team ids (from
 * `project_spaces`); a project with no entry has no team.
 */
export function matchesProjectFilters(
  project: ProjectTracking,
  filters: ProjectsFilters,
  spaceIdsByProject: Map<string, string[]>,
  now: number,
): boolean {
  if (filters.statuses.length && !filters.statuses.includes(project.status)) {
    return false;
  }
  if (filters.spaceIds.length) {
    const teams = spaceIdsByProject.get(project.id) ?? [];
    const ok = filters.spaceIds.some((s) =>
      s === NONE ? teams.length === 0 : teams.includes(s),
    );
    if (!ok) return false;
  }
  if (filters.memberIds.length) {
    if (!filters.memberIds.some((m) => project.contributorIds.includes(m))) {
      return false;
    }
  }
  if (filters.target.length) {
    const buckets = projectTargetBuckets(project, now);
    if (!filters.target.some((b) => buckets.includes(b))) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export type ProjectFacetData = {
  spaces: { id: string; name: string; color: EntityColor }[];
  members: ProjectMember[];
};

function ColorDot({ color }: { color: EntityColor }) {
  return <span className={cn("size-2 shrink-0 rounded-full", LABEL_DOT[color])} />;
}

function memberInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function buildOptions(facet: ProjectFacetKey, data: ProjectFacetData): Option[] {
  switch (facet) {
    case "status":
      return STATUS_ORDER.map<Option>((s) => ({
        value: s,
        label: PROJECT_STATUS_META[s].label,
        node: (
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              PROJECT_STATUS_META[s].dot,
            )}
          />
        ),
      }));
    case "team":
      return [
        {
          value: NONE,
          label: "No team",
          keywords: "none no team",
          node: <ColorDot color="slate" />,
        },
        ...data.spaces.map<Option>((s) => ({
          value: s.id,
          label: s.name,
          keywords: s.name,
          node: <ColorDot color={s.color} />,
        })),
      ];
    case "member":
      return data.members.map<Option>((m) => ({
        value: m.id,
        label: m.name ?? "Member",
        keywords: m.name ?? "",
        node: (
          <Avatar size="sm" className="size-5">
            {m.avatarUrl ? (
              <AvatarImage src={m.avatarUrl} alt={m.name ?? "Member"} />
            ) : null}
            <AvatarFallback className="bg-muted text-xs">
              {memberInitials(m.name ?? "?")}
            </AvatarFallback>
          </Avatar>
        ),
      }));
    case "target":
      return (["overdue", "month", "quarter", "none"] as TargetBucket[]).map<Option>(
        (b) => ({
          value: b,
          label: TARGET_LABELS[b],
          node: <CalendarClock className="size-3.5 text-muted-foreground" />,
        }),
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Facet chip                                                                 */
/* -------------------------------------------------------------------------- */

function FacetChip({
  facet,
  filters,
  onChange,
  data,
  autoOpen,
  onEmptyClose,
}: {
  facet: ProjectFacetKey;
  filters: ProjectsFilters;
  onChange: (next: ProjectsFilters) => void;
  data: ProjectFacetData;
  autoOpen: boolean;
  onEmptyClose: () => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const selected = filters[FACET_FIELD[facet]] as string[];
  const meta = FACET_META[facet];
  const options = useMemo(() => buildOptions(facet, data), [facet, data]);

  function commit(values: string[]) {
    onChange({ ...filters, [FACET_FIELD[facet]]: values });
  }
  function toggle(value: string) {
    commit(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  const summary = summaryFor(selected, options);
  const { Icon } = meta;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && selected.length === 0) onEmptyClose();
      }}
    >
      <span
        className={cn(
          "inline-flex h-7 items-center rounded-md text-xs font-medium transition-colors",
          selected.length > 0
            ? "bg-accent-pressed text-foreground"
            : "text-faint-foreground hover:bg-accent",
        )}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`${meta.label} filter`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md pr-2 pl-2.5 focus-visible:outline-none focus-visible:shadow-focus"
            />
          }
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">{meta.label}</span>
          {selected.length > 0 ? (
            <>
              <span aria-hidden className="text-muted-foreground">
                :
              </span>
              <span className="max-w-[10rem] truncate">{summary}</span>
            </>
          ) : null}
        </PopoverTrigger>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              commit([]);
              onEmptyClose();
            }}
            aria-label={`Clear ${meta.label} filter`}
            className="mr-1 inline-flex size-4 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </span>
      <PopoverContent align="start" className="w-64 p-0">
        <ValuePicker
          options={options}
          selected={selected}
          onToggle={toggle}
          searchable={meta.searchable}
          searchPlaceholder={`Search ${meta.label.toLowerCase()}…`}
        />
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter bar — button + chips, inline in the projects toolbar row            */
/* -------------------------------------------------------------------------- */

export function ProjectsFilterBar({
  filters,
  onChange,
  data,
}: {
  filters: ProjectsFilters;
  onChange: (next: ProjectsFilters) => void;
  data: ProjectFacetData;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // A just-picked facet renders as an auto-opened chip so values can be
  // picked immediately (the tasks board's addedFacet flow, kept local here).
  const [addedFacet, setAddedFacet] = useState<ProjectFacetKey | null>(null);

  const active = FACET_ORDER.filter(
    (f) => (filters[FACET_FIELD[f]] as string[]).length > 0,
  );
  const shown =
    addedFacet && !active.includes(addedFacet) ? [...active, addedFacet] : active;
  const inactive = FACET_ORDER.filter((f) => !shown.includes(f));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Add filter"
              title="Add filter"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
                active.length > 0 ? "text-foreground" : "text-secondary-ink",
                "hover:bg-accent",
                "focus-visible:outline-none focus-visible:shadow-focus",
                "aria-expanded:bg-accent-pressed aria-expanded:text-foreground",
                "data-popup-open:bg-accent-pressed data-popup-open:text-foreground",
              )}
            />
          }
        >
          <ListFilter className="size-3.5" />
          <span>Filter</span>
          {active.length > 0 ? (
            <span className="rounded-md bg-accent-pressed px-1 text-xs tabular-nums text-foreground">
              {active.length}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-0">
          <Command>
            <CommandList className="max-h-72">
              <CommandEmpty>All filters added.</CommandEmpty>
              <CommandGroup>
                {inactive.map((f) => {
                  const { label, Icon } = FACET_META[f];
                  return (
                    <CommandItem
                      key={f}
                      value={label}
                      onSelect={() => {
                        setAddedFacet(f);
                        setMenuOpen(false);
                      }}
                      className="gap-2"
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="flex-1">{label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {shown.map((facet) => (
        <FacetChip
          key={facet}
          facet={facet}
          filters={filters}
          onChange={onChange}
          data={data}
          autoOpen={facet === addedFacet}
          onEmptyClose={() => setAddedFacet(null)}
        />
      ))}

      {active.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            onChange(EMPTY_PROJECT_FILTERS);
            setAddedFacet(null);
          }}
          className="ml-0.5 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
        >
          <Plus aria-hidden className="size-3 rotate-45" />
          Clear all
        </button>
      ) : null}
    </div>
  );
}
