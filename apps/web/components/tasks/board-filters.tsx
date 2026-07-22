"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  Circle,
  Flag,
  FolderKanban,
  Hash,
  ListFilter,
  PenLine,
  Plus,
  Sparkles,
  Tag,
  User,
  X,
  Zap,
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
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import {
  propertyMembersQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { labelsQueryOptions } from "@/lib/query/label-queries";
import type {
  EntityColor,
  RecordSource,
  TaskPriority,
  TaskStatus,
} from "@/lib/db/types";
import {
  COLUMNS,
  PRIORITY_IDS,
  PRIORITY_META,
  type SortBy,
  type Task,
} from "./kanban";
import { PriorityBars, StatusIcon } from "./task-icons";
import { initials } from "./task-property-menus";
import type { StatusPreset } from "./board-toolbar";

/* -------------------------------------------------------------------------- */
/* Filter model                                                               */
/* -------------------------------------------------------------------------- */

/** Buckets for the Due-date facet, evaluated against `task.due_at`. */
export type DueBucket = "overdue" | "today" | "week" | "none";

/**
 * The board's full filter state. `search` / `statusPreset` / `sortBy` are the
 * always-visible toolbar controls; the remaining arrays are the additive
 * facets surfaced as removable chips (Linear model).
 */
/** Stackable sort dimensions (ClickUp-style multi-key ordering). */
export type SortStackKey = "priority" | "due_at";

export type BoardFilters = {
  search: string;
  statusPreset: StatusPreset;
  sortBy: SortBy;
  /** Ordered sort stack — first key wins, later keys break ties, manual
   *  position is the final tie-break. Empty = single `sortBy` behavior. */
  sortKeys: SortStackKey[];
  /* Facets — empty array = facet inactive. */
  assignees: string[]; // member ids; `UNASSIGNED` sentinel = no assignee
  creators: string[]; // member ids (created_by)
  priorities: TaskPriority[];
  statuses: TaskStatus[];
  spaceIds: string[]; // teams; `NONE` sentinel = no team
  projectIds: string[]; // `NONE` sentinel = no project
  labelIds: string[];
  due: DueBucket[];
  sources: RecordSource[];
};

export const EMPTY_FILTERS: BoardFilters = {
  search: "",
  statusPreset: "all",
  sortBy: "manual",
  sortKeys: [],
  assignees: [],
  creators: [],
  priorities: [],
  statuses: [],
  spaceIds: [],
  projectIds: [],
  labelIds: [],
  due: [],
  sources: [],
};

/** Sentinels — real ids never collide with these. */
export const UNASSIGNED = "__unassigned__";
export const NONE = "__none__";

/** The nine facet dimensions, in menu + chip order. */
export type FacetKey =
  | "assignee"
  | "creator"
  | "priority"
  | "status"
  | "space"
  | "project"
  | "label"
  | "due"
  | "source";

export const FACET_ORDER: FacetKey[] = [
  "assignee",
  "creator",
  "priority",
  "status",
  "space",
  "project",
  "label",
  "due",
  "source",
];

/** Which `BoardFilters` array each facet reads/writes. */
const FACET_FIELD: Record<FacetKey, keyof BoardFilters> = {
  assignee: "assignees",
  creator: "creators",
  priority: "priorities",
  status: "statuses",
  space: "spaceIds",
  project: "projectIds",
  label: "labelIds",
  due: "due",
  source: "sources",
};

const FACET_META: Record<
  FacetKey,
  { label: string; Icon: typeof User; searchable: boolean }
> = {
  assignee: { label: "Assignee", Icon: User, searchable: true },
  creator: { label: "Created by", Icon: PenLine, searchable: true },
  priority: { label: "Priority", Icon: Flag, searchable: false },
  status: { label: "Status", Icon: Circle, searchable: false },
  space: { label: "Team", Icon: Hash, searchable: true },
  project: { label: "Project", Icon: FolderKanban, searchable: true },
  label: { label: "Label", Icon: Tag, searchable: true },
  due: { label: "Due", Icon: CalendarClock, searchable: false },
  source: { label: "Source", Icon: Zap, searchable: false },
};

const DUE_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  none: "No due date",
};

const SOURCE_LABELS: Record<RecordSource, string> = {
  user: "Created by people",
  workflow: "Created by a workflow",
  ai: "Created by AI",
};

/* -------------------------------------------------------------------------- */
/* Pure helpers (used by the board's filter memo)                             */
/* -------------------------------------------------------------------------- */

function facetValues(filters: BoardFilters, facet: FacetKey): string[] {
  return filters[FACET_FIELD[facet]] as string[];
}

export function activeFacetCount(filters: BoardFilters): number {
  return FACET_ORDER.reduce(
    (n, f) => n + (facetValues(filters, f).length > 0 ? 1 : 0),
    0,
  );
}

export function hasAnyFacet(filters: BoardFilters): boolean {
  return activeFacetCount(filters) > 0;
}

/** Clear every facet (leaves search / preset / sort untouched). */
export function clearFacets(filters: BoardFilters): BoardFilters {
  return {
    ...filters,
    assignees: [],
    creators: [],
    priorities: [],
    statuses: [],
    spaceIds: [],
    projectIds: [],
    labelIds: [],
    due: [],
    sources: [],
  };
}

/** Which due-buckets a task falls into, relative to `now`. */
function taskDueBuckets(task: Task, now: number): DueBucket[] {
  if (!task.due_at) return ["none"];
  const t = Date.parse(task.due_at);
  if (Number.isNaN(t)) return ["none"];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startToday = start.getTime();
  const endToday = startToday + 86_400_000;
  const endWeek = startToday + 7 * 86_400_000;
  const out: DueBucket[] = [];
  if (t < startToday && task.status !== "done") out.push("overdue");
  if (t >= startToday && t < endToday) out.push("today");
  if (t >= startToday && t < endWeek) out.push("week");
  return out;
}

/**
 * AND across facets, OR within a facet. `currentUserId` is unused here — "Me"
 * rows store the real user id, so no special-casing is needed at match time.
 */
export function matchesFacets(
  task: Task,
  filters: BoardFilters,
  now: number,
): boolean {
  if (filters.assignees.length) {
    const ok = filters.assignees.some((a) =>
      a === UNASSIGNED ? task.assignee_id == null : task.assignee_id === a,
    );
    if (!ok) return false;
  }
  if (filters.creators.length) {
    if (!filters.creators.includes(task.created_by ?? "")) return false;
  }
  if (filters.priorities.length && !filters.priorities.includes(task.priority)) {
    return false;
  }
  if (filters.statuses.length && !filters.statuses.includes(task.status)) {
    return false;
  }
  if (filters.spaceIds.length) {
    const ok = filters.spaceIds.some((s) =>
      s === NONE ? task.space_id == null : task.space_id === s,
    );
    if (!ok) return false;
  }
  if (filters.projectIds.length) {
    const ok = filters.projectIds.some((p) =>
      p === NONE ? task.project_id == null : task.project_id === p,
    );
    if (!ok) return false;
  }
  if (filters.labelIds.length) {
    const labels = task.labels ?? [];
    if (!filters.labelIds.some((l) => labels.includes(l))) return false;
  }
  if (filters.due.length) {
    const buckets = taskDueBuckets(task, now);
    if (!filters.due.some((b) => buckets.includes(b))) return false;
  }
  if (filters.sources.length) {
    if (!filters.sources.includes((task.source ?? "user") as RecordSource)) {
      return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Option shape                                                               */
/* -------------------------------------------------------------------------- */

type Option = {
  value: string;
  label: string;
  /** Search keywords (name + email etc.) for the Command filter. */
  keywords?: string;
  node: React.ReactNode; // leading glyph
};

function ColorDot({ color }: { color: EntityColor }) {
  return <span className={cn("size-2 shrink-0 rounded-full", LABEL_DOT[color])} />;
}

function MemberAvatar({ member }: { member: PropertyMember }) {
  return (
    <Avatar size="sm" className="size-5">
      {member.avatarUrl ? (
        <AvatarImage src={member.avatarUrl} alt={member.name ?? "Member"} />
      ) : null}
      <AvatarFallback className="bg-muted text-[0.5625rem]">
        {initials(member.name ?? "?")}
      </AvatarFallback>
    </Avatar>
  );
}

/** Bundled option data — fetched once in the bar, threaded to every control. */
export type FacetData = {
  members: PropertyMember[];
  spaces: { id: string; name: string; color: EntityColor }[];
  projects: { id: string; name: string; color: EntityColor }[];
  labels: { id: string; name: string; color: EntityColor }[];
};

function buildOptions(
  facet: FacetKey,
  data: FacetData,
  currentUserId: string,
): Option[] {
  switch (facet) {
    case "assignee": {
      const people = data.members.map<Option>((m) => ({
        value: m.id,
        label:
          m.id === currentUserId ? `${m.name ?? "Me"} · you` : m.name ?? "Member",
        keywords: `${m.name ?? ""} ${m.email ?? ""} me`,
        node: <MemberAvatar member={m} />,
      }));
      return [
        {
          value: UNASSIGNED,
          label: "Unassigned",
          keywords: "unassigned none nobody",
          node: <User className="size-4 text-muted-foreground" />,
        },
        ...people,
      ];
    }
    case "creator":
      return data.members.map<Option>((m) => ({
        value: m.id,
        label:
          m.id === currentUserId ? `${m.name ?? "Me"} · you` : m.name ?? "Member",
        keywords: `${m.name ?? ""} ${m.email ?? ""} me`,
        node: <MemberAvatar member={m} />,
      }));
    case "priority":
      return PRIORITY_IDS.map<Option>((p) => ({
        value: p,
        label: PRIORITY_META[p].label,
        node: (
          <span className="flex w-4 items-center justify-center">
            <PriorityBars priority={p} />
          </span>
        ),
      }));
    case "status":
      return COLUMNS.map<Option>((c) => ({
        value: c.id,
        label: c.label,
        node: <StatusIcon status={c.id} className="size-3.5" />,
      }));
    case "space":
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
    case "project":
      return [
        {
          value: NONE,
          label: "No project",
          keywords: "none no project",
          node: <ColorDot color="slate" />,
        },
        ...data.projects.map<Option>((p) => ({
          value: p.id,
          label: p.name,
          keywords: p.name,
          node: <ColorDot color={p.color} />,
        })),
      ];
    case "label":
      return data.labels.map<Option>((l) => ({
        value: l.id,
        label: l.name,
        keywords: l.name,
        node: <ColorDot color={l.color} />,
      }));
    case "due":
      return (["overdue", "today", "week", "none"] as DueBucket[]).map<Option>(
        (b) => ({
          value: b,
          label: DUE_LABELS[b],
          node: <CalendarClock className="size-3.5 text-muted-foreground" />,
        }),
      );
    case "source":
      return (["user", "workflow", "ai"] as RecordSource[]).map<Option>((s) => ({
        value: s,
        label: SOURCE_LABELS[s],
        node:
          s === "workflow" ? (
            <Zap className="size-3.5 text-muted-foreground" />
          ) : s === "ai" ? (
            <Sparkles className="size-3.5 text-muted-foreground" />
          ) : (
            <User className="size-3.5 text-muted-foreground" />
          ),
      }));
  }
}

/* -------------------------------------------------------------------------- */
/* Value picker (multi-select)                                                */
/* -------------------------------------------------------------------------- */

function ValuePicker({
  options,
  selected,
  onToggle,
  searchable,
  searchPlaceholder,
}: {
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  searchable: boolean;
  searchPlaceholder: string;
}) {
  const rows = (
    <CommandList className="max-h-64">
      <CommandEmpty>No matches.</CommandEmpty>
      <CommandGroup>
        {options.map((opt) => {
          const isOn = selected.includes(opt.value);
          return (
            <CommandItem
              key={opt.value}
              value={`${opt.label} ${opt.keywords ?? ""}`}
              onSelect={() => onToggle(opt.value)}
              className="gap-2"
            >
              <span className="flex size-5 items-center justify-center">
                {opt.node}
              </span>
              <span className="flex-1 truncate">{opt.label}</span>
              <Check
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground",
                  isOn ? "opacity-100" : "opacity-0",
                )}
              />
            </CommandItem>
          );
        })}
      </CommandGroup>
    </CommandList>
  );

  return (
    <Command>
      {searchable ? <CommandInput placeholder={searchPlaceholder} /> : null}
      {rows}
    </Command>
  );
}

/* -------------------------------------------------------------------------- */
/* Facet chip                                                                 */
/* -------------------------------------------------------------------------- */

function summaryFor(selected: string[], options: Option[]): string {
  const byValue = new Map(options.map((o) => [o.value, o.label] as const));
  const first = (byValue.get(selected[0]!) ?? "").replace(/ · you$/, "");
  return selected.length === 1 ? first : `${first} +${selected.length - 1}`;
}

function FacetControl({
  facet,
  filters,
  onChange,
  currentUserId,
  data,
  autoOpen,
  onEmptyClose,
}: {
  facet: FacetKey;
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  currentUserId: string;
  data: FacetData;
  autoOpen: boolean;
  onEmptyClose: () => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const field = FACET_FIELD[facet];
  const selected = filters[field] as string[];
  const meta = FACET_META[facet];
  const options = useMemo(
    () => buildOptions(facet, data, currentUserId),
    [facet, data, currentUserId],
  );

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange({ ...filters, [field]: next });
  }
  function clear() {
    onChange({ ...filters, [field]: [] });
    onEmptyClose();
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
          "inline-flex h-7 items-center rounded-full border text-xs transition-colors",
          selected.length > 0
            ? "border-primary/40 bg-primary/10 text-foreground"
            : "border-dashed border-border text-muted-foreground",
        )}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`${meta.label} filter`}
              className="inline-flex h-7 items-center gap-1.5 rounded-full pr-2 pl-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            onClick={clear}
            aria-label={`Clear ${meta.label} filter`}
            className="mr-1 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
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
/* "+ Filter" menu (toolbar)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The toolbar entry point. Lists only facets that aren't active yet; picking
 * one calls `onPick`, which the board renders as an auto-opened chip.
 */
export function FilterMenu({
  filters,
  onPick,
}: {
  filters: BoardFilters;
  onPick: (facet: FacetKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const inactive = FACET_ORDER.filter((f) => facetValues(filters, f).length === 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Add filter"
            title="Add filter"
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors",
              "hover:bg-foreground/[0.06] hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "aria-expanded:bg-foreground/[0.06] aria-expanded:text-foreground",
              "data-popup-open:bg-foreground/[0.06] data-popup-open:text-foreground",
            )}
          />
        }
      >
        <ListFilter className="size-3.5" />
        <span className="max-sm:sr-only">Filter</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-0">
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
                      onPick(f);
                      setOpen(false);
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
  );
}

/* -------------------------------------------------------------------------- */
/* Active filter bar (row below the toolbar)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Renders one chip per active facet, plus the just-added facet (auto-opened
 * so the user can pick values immediately). Returns null when there's nothing
 * to show, keeping the board flush against the toolbar until filtering starts.
 */
export function ActiveFilterBar({
  propertyId,
  filters,
  onChange,
  currentUserId,
  addedFacet,
  onResolveAdded,
}: {
  propertyId: string;
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  currentUserId: string;
  addedFacet: FacetKey | null;
  onResolveAdded: () => void;
}) {
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: labels = [] } = useQuery(labelsQueryOptions(propertyId));

  const data: FacetData = useMemo(
    () => ({ members, spaces, projects, labels }),
    [members, spaces, projects, labels],
  );

  const active = FACET_ORDER.filter((f) => facetValues(filters, f).length > 0);
  const shown =
    addedFacet && !active.includes(addedFacet) ? [...active, addedFacet] : active;

  if (shown.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
      {shown.map((facet) => (
        <FacetControl
          key={facet}
          facet={facet}
          filters={filters}
          onChange={onChange}
          currentUserId={currentUserId}
          data={data}
          autoOpen={facet === addedFacet}
          onEmptyClose={onResolveAdded}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          onChange(clearFacets(filters));
          onResolveAdded();
        }}
        className="ml-0.5 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <Plus aria-hidden className="size-3 rotate-45" />
        Clear all
      </button>
    </div>
  );
}
