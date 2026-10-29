"use client";

import { taskAssigneeIds } from "@/lib/tasks/assignees";
import { isDone, isUuid, type StatusCatalog } from "@/lib/tasks/statuses";
import { useStatusCatalog } from "@/lib/query/status-queries";
import { FIELD_TYPE_ICON } from "./field-type-icon";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  Circle,
  Flag,
  FolderKanban,
  Hash,
  IterationCcw,
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
import { cyclesQueryOptions } from "@/lib/query/cycle-queries";
import { cycleLabel } from "@/lib/cycles/plan";
import {
  customFieldsQueryOptions,
  type CustomFieldRow,
} from "@/lib/query/custom-field-queries";
import { isChoiceField, optionColor } from "@/lib/tasks/custom-field-options";
import type {
  EntityColor,
  RecordSource,
  TaskPriority,
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
  /** Category literals (`todo` …, any list) and/or status ids (one list's
   *  pipeline stage, 0114) — OR'd like every facet. */
  statuses: string[];
  spaceIds: string[]; // teams; `NONE` sentinel = no team
  projectIds: string[]; // `NONE` sentinel = no project
  labelIds: string[];
  cycleIds: string[]; // `NONE` sentinel = in no cycle
  due: DueBucket[];
  sources: RecordSource[];
  /** Custom-field filters (migration 0080): field id → selected values.
   *  Values are option ids for dropdowns, "true"/"false" for checkboxes, and
   *  the FIELD_SET / FIELD_EMPTY sentinels for has-a-value / is-empty. */
  fieldValues: Record<string, string[]>;
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
  cycleIds: [],
  due: [],
  sources: [],
  fieldValues: {},
};

/** Sentinels — real ids never collide with these. */
export const UNASSIGNED = "__unassigned__";
export const NONE = "__none__";
/** Custom-field sentinels: any value at all / no value at all. */
export const FIELD_SET = "__set__";
export const FIELD_EMPTY = "__empty__";

/** The nine built-in facet dimensions, in menu + chip order. */
export type StaticFacetKey =
  | "assignee"
  | "creator"
  | "priority"
  | "status"
  | "space"
  | "project"
  | "label"
  | "cycle"
  | "due"
  | "source";

/**
 * A facet is either one of the built-ins or a custom field, addressed as
 * `field:<uuid>`. Custom fields are defined per property at runtime, so they
 * can't live in a fixed union — encoding the id in the key lets them flow
 * through the same menu / chip / matching pipeline as everything else.
 */
export type FacetKey = StaticFacetKey | `field:${string}`;

export function isFieldFacet(facet: FacetKey): facet is `field:${string}` {
  return facet.startsWith("field:");
}

export function fieldFacetKey(fieldId: string): FacetKey {
  return `field:${fieldId}`;
}

export function fieldIdOf(facet: FacetKey): string {
  return facet.slice("field:".length);
}

export const FACET_ORDER: StaticFacetKey[] = [
  "assignee",
  "creator",
  "priority",
  "status",
  "space",
  "project",
  "label",
  "cycle",
  "due",
  "source",
];

/** Which `BoardFilters` array each facet reads/writes. */
const FACET_FIELD: Record<StaticFacetKey, keyof BoardFilters> = {
  assignee: "assignees",
  creator: "creators",
  priority: "priorities",
  status: "statuses",
  space: "spaceIds",
  project: "projectIds",
  label: "labelIds",
  cycle: "cycleIds",
  due: "due",
  source: "sources",
};

const FACET_META: Record<
  StaticFacetKey,
  { label: string; Icon: typeof User; searchable: boolean }
> = {
  assignee: { label: "Assignee", Icon: User, searchable: true },
  creator: { label: "Created by", Icon: PenLine, searchable: true },
  priority: { label: "Priority", Icon: Flag, searchable: false },
  status: { label: "Status", Icon: Circle, searchable: false },
  space: { label: "Team", Icon: Hash, searchable: true },
  project: { label: "Project", Icon: FolderKanban, searchable: true },
  label: { label: "Label", Icon: Tag, searchable: true },
  cycle: { label: "Cycle", Icon: IterationCcw, searchable: true },
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
  if (isFieldFacet(facet)) return filters.fieldValues[fieldIdOf(facet)] ?? [];
  return filters[FACET_FIELD[facet]] as string[];
}

/** Field facets currently carrying a selection, in field id order. */
export function activeFieldFacets(filters: BoardFilters): FacetKey[] {
  return Object.entries(filters.fieldValues)
    .filter(([, values]) => values.length > 0)
    .map(([fieldId]) => fieldFacetKey(fieldId));
}

export function activeFacetCount(filters: BoardFilters): number {
  const builtIn = FACET_ORDER.reduce(
    (n, f) => n + (facetValues(filters, f).length > 0 ? 1 : 0),
    0,
  );
  return builtIn + activeFieldFacets(filters).length;
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
    cycleIds: [],
    due: [],
    sources: [],
    fieldValues: {},
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
  if (t < startToday && !isDone(task)) out.push("overdue");
  if (t >= startToday && t < endToday) out.push("today");
  if (t >= startToday && t < endWeek) out.push("week");
  return out;
}

/**
 * Custom-field values for the whole board, normalized to comparable strings:
 * task id → field id → values. Absence of a key IS the "empty" signal, so no
 * field definitions are needed at match time.
 *
 * Always an ARRAY, even for single-valued fields — a `multi_select` (label)
 * field holds several option ids at once, and matching "has any of these"
 * uniformly beats branching on the field type at match time.
 */
export type FieldValueIndex = Map<string, Map<string, string[]>>;

/**
 * AND across facets, OR within a facet. `currentUserId` is unused here — "Me"
 * rows store the real user id, so no special-casing is needed at match time.
 * `fieldIndex` is only consulted when a custom-field filter is active.
 */
export function matchesFacets(
  task: Task,
  filters: BoardFilters,
  now: number,
  fieldIndex?: FieldValueIndex,
): boolean {
  if (filters.assignees.length) {
    const ids = taskAssigneeIds(task);
    const ok = filters.assignees.some((a) =>
      a === UNASSIGNED ? ids.length === 0 : ids.includes(a),
    );
    if (!ok) return false;
  }
  if (filters.creators.length) {
    if (!filters.creators.includes(task.created_by ?? "")) return false;
  }
  if (filters.priorities.length && !filters.priorities.includes(task.priority)) {
    return false;
  }
  if (filters.statuses.length) {
    const ok = filters.statuses.some((s) =>
      isUuid(s) ? task.status_id === s : task.status === s,
    );
    if (!ok) return false;
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
  if (filters.cycleIds.length) {
    const ok = filters.cycleIds.some((c) =>
      c === NONE ? task.cycle_id == null : task.cycle_id === c,
    );
    if (!ok) return false;
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
  // No index yet (the values query is still loading — it cold-starts the
  // moment the first field filter is picked): don't judge field clauses
  // against an empty index, which would flash the board to zero tasks and
  // snap back. Skipping them shows the un-narrowed set for a beat instead.
  if (fieldIndex) {
    for (const [fieldId, selected] of Object.entries(filters.fieldValues)) {
      if (selected.length === 0) continue;
      const values = fieldIndex.get(task.id)?.get(fieldId);
      const ok = selected.some((v) => {
        if (v === FIELD_EMPTY) return values === undefined;
        if (v === FIELD_SET) return values !== undefined;
        return values?.includes(v) ?? false;
      });
      if (!ok) return false;
    }
  }
  return true;
}

/** Build the match-time index from raw `task_field_values` rows. */
export function buildFieldValueIndex(
  rows: { task_id: string; field_id: string; value: unknown }[],
): FieldValueIndex {
  const index: FieldValueIndex = new Map();
  for (const row of rows) {
    let perTask = index.get(row.task_id);
    if (!perTask) {
      perTask = new Map();
      index.set(row.task_id, perTask);
    }
    // Label fields arrive as an array of option ids; everything else is a
    // scalar that becomes a one-element array. An empty array means the value
    // was cleared, which reads as absent.
    const values = Array.isArray(row.value)
      ? row.value.map((v) => String(v))
      : [String(row.value)];
    if (values.length > 0) perTask.set(row.field_id, values);
  }
  return index;
}

/* -------------------------------------------------------------------------- */
/* Option shape                                                               */
/* -------------------------------------------------------------------------- */

export type Option = {
  value: string;
  label: string;
  /** Search keywords (name + email etc.) for the Command filter. */
  keywords?: string;
  node: React.ReactNode; // leading glyph
  /** Section heading in the picker; consecutive options share one group. */
  group?: string;
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
      <AvatarFallback className="bg-muted text-xs">
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
  /** Live cycles (current + upcoming, plus recent past), labelled with their team. */
  cycles: { id: string; label: string; current: boolean }[];
  customFields: CustomFieldRow[];
  /** Lists + pipelines (0114) — the Status facet groups stages by list. */
  catalog: StatusCatalog;
};

/** Icon per custom-field type — shared with the sidebar and the manager. */

/** Chip/menu metadata for any facet, built-in or custom field. */
function facetMeta(
  facet: FacetKey,
  data: FacetData,
): { label: string; Icon: typeof User; searchable: boolean } {
  if (!isFieldFacet(facet)) return FACET_META[facet];
  const field = data.customFields.find((f) => f.id === fieldIdOf(facet));
  return {
    label: field?.name ?? "Field",
    Icon: field ? FIELD_TYPE_ICON[field.type] : ListFilter,
    // Dropdowns and people can carry a long list; the rest are 2-3 rows.
    searchable: field?.type === "people" || (field?.options.length ?? 0) > 8,
  };
}

function buildOptions(
  facet: FacetKey,
  data: FacetData,
  currentUserId: string,
): Option[] {
  if (isFieldFacet(facet)) return buildFieldOptions(facet, data);
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
      return [
        ...COLUMNS.map<Option>((c) => ({
          value: c.id,
          label: c.label,
          keywords: `${c.label} any list category`,
          group: "Any list",
          node: <StatusIcon status={c.id} className="size-3.5" />,
        })),
        ...pipelineStatusOptions(data),
      ];
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
    case "cycle":
      return [
        {
          value: NONE,
          label: "No cycle",
          keywords: "none no cycle unplanned",
          node: <IterationCcw className="size-3.5 text-muted-foreground" />,
        },
        ...data.cycles.map<Option>((c) => ({
          value: c.id,
          label: c.current ? `${c.label} · current` : c.label,
          keywords: `${c.label} ${c.current ? "current" : ""}`,
          node: (
            <IterationCcw
              className={cn(
                "size-3.5",
                c.current ? "text-foreground" : "text-muted-foreground",
              )}
            />
          ),
        })),
      ];
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

/**
 * One group per status PIPELINE in use, headed by the list(s) that run it —
 * lists sharing a set (every team list inheriting the property default) would
 * otherwise repeat the same stages N times. Values are status ids, so a
 * saved filter survives a rename. The category rows above stay the way to say
 * "done anywhere".
 */
function pipelineStatusOptions(data: FacetData): Option[] {
  const { catalog } = data;
  const listsBySet = new Map<string, string[]>();
  for (const l of catalog.lists) {
    if (l.archived_at) continue;
    const names = listsBySet.get(l.status_set_id) ?? [];
    names.push(l.name);
    listsBySet.set(l.status_set_id, names);
  }
  const out: Option[] = [];
  for (const [setId, names] of listsBySet) {
    const set = catalog.sets.get(setId);
    const heading =
      names.length === 1
        ? names[0]!
        : `${set?.name ?? "Shared"} · ${names.length} lists`;
    for (const s of catalog.statusesOfSet(setId)) {
      out.push({
        value: s.id,
        label: s.name,
        keywords: `${s.name} ${names.join(" ")}`,
        group: heading,
        node: (
          <StatusIcon
            category={s.category}
            blocked={s.is_blocked}
            color={s.color}
            className="size-3.5"
          />
        ),
      });
    }
  }
  return out;
}

/**
 * Options for a custom-field facet. Dropdowns list their real options (values
 * are option ids, so renaming an option never breaks a saved filter) and
 * checkboxes list both states; free-text / number / date fields can't offer a
 * meaningful value list, so they filter on presence instead.
 */
function buildFieldOptions(facet: FacetKey, data: FacetData): Option[] {
  const field = data.customFields.find((f) => f.id === fieldIdOf(facet));
  if (!field) return [];
  const glyph = <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />;
  const emptyOption: Option = {
    value: FIELD_EMPTY,
    label: "Empty",
    keywords: "empty none not set blank",
    node: <span className="size-2 shrink-0 rounded-full border border-muted-foreground/40" />,
  };

  // Dropdown and label fields both filter on their own option list — a label
  // field matches when the task carries ANY of the ticked options.
  if (isChoiceField(field.type)) {
    return [
      ...field.options.map<Option>((o) => ({
        value: o.id,
        label: o.label,
        keywords: o.label,
        node: (
          <span
            className={cn("size-2 shrink-0 rounded-full", LABEL_DOT[optionColor(o)])}
          />
        ),
      })),
      emptyOption,
    ];
  }
  // People fields filter like the assignee facet: anyone ticked matches.
  if (field.type === "people") {
    return [
      ...data.members.map<Option>((m) => ({
        value: m.id,
        label: m.name ?? "Member",
        keywords: `${m.name ?? ""} ${m.email ?? ""}`,
        node: <MemberAvatar member={m} />,
      })),
      emptyOption,
    ];
  }
  if (field.type === "checkbox") {
    return [
      { value: "true", label: "Checked", keywords: "checked yes true", node: glyph },
      { value: "false", label: "Unchecked", keywords: "unchecked no false", node: glyph },
      emptyOption,
    ];
  }
  return [
    {
      value: FIELD_SET,
      label: "Has a value",
      keywords: "set any value filled",
      node: glyph,
    },
    emptyOption,
  ];
}

/* -------------------------------------------------------------------------- */
/* Value picker (multi-select)                                                */
/* -------------------------------------------------------------------------- */

export function ValuePicker({
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
  // Consecutive options sharing `group` render under one heading; ungrouped
  // pickers stay a single headless group.
  const groups: { heading?: string; options: Option[] }[] = [];
  for (const opt of options) {
    const last = groups[groups.length - 1];
    if (last && last.heading === opt.group) last.options.push(opt);
    else groups.push({ heading: opt.group, options: [opt] });
  }
  const rows = (
    <CommandList className="max-h-72">
      <CommandEmpty>No matches.</CommandEmpty>
      {groups.map((g, gi) => (
      <CommandGroup key={`${gi}:${g.heading ?? ""}`} heading={g.heading}>
        {g.options.map((opt) => {
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
      ))}
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

export function summaryFor(selected: string[], options: Option[]): string {
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
  const selected = facetValues(filters, facet);
  const meta = facetMeta(facet, data);
  const options = useMemo(
    () => buildOptions(facet, data, currentUserId),
    [facet, data, currentUserId],
  );

  /** Write a facet's values back into whichever slice of state owns it. */
  function commit(values: string[]): BoardFilters {
    if (isFieldFacet(facet)) {
      const fieldId = fieldIdOf(facet);
      const nextFields = { ...filters.fieldValues };
      if (values.length === 0) delete nextFields[fieldId];
      else nextFields[fieldId] = values;
      return { ...filters, fieldValues: nextFields };
    }
    return { ...filters, [FACET_FIELD[facet]]: values };
  }

  function toggle(value: string) {
    onChange(
      commit(
        selected.includes(value)
          ? selected.filter((v) => v !== value)
          : [...selected, value],
      ),
    );
  }
  function clear() {
    onChange(commit([]));
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
      {/* gr8r `.chip` (view-engine.js filterChips): "<icon> <b>Field</b> is
          <values>" opens the value picker; the ✕ drops the facet. A facet
          that was just added (no values yet) reads "is any". */}
      <span className="chip">
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`${meta.label} filter`}
              style={{ display: "inline-flex", gap: 5, alignItems: "center" }}
            />
          }
        >
          <Icon className="i" size={12} strokeWidth={1.8} aria-hidden />
          <b>{meta.label}</b> is{" "}
          <span className="max-w-[10rem] truncate">
            {selected.length > 0 ? summary : "any"}
          </span>
        </PopoverTrigger>
        <button
          type="button"
          className="ibtn"
          onClick={clear}
          aria-label={`Remove ${meta.label} filter`}
        >
          <X className="i" size={12} strokeWidth={1.8} aria-hidden />
        </button>
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
 * The toolbar entry point — a Linear-style always-labeled "Filter" button at
 * the LEFT of the toolbar, with a count badge while facets are narrowing.
 * Lists only facets that aren't active yet; picking one calls `onPick`, which
 * the board renders as an auto-opened chip.
 */
export function FilterMenu({
  filters,
  onPick,
  customFields = [],
  variant = "toolbar",
}: {
  filters: BoardFilters;
  onPick: (facet: FacetKey) => void;
  /** Custom fields offered alongside the built-in facets. */
  customFields?: CustomFieldRow[];
  /** `toolbar` = gr8r's "Filter" button; `add` = the chips bar's "+ Add". */
  variant?: "toolbar" | "add";
}) {
  const [open, setOpen] = useState(false);
  const inactive = FACET_ORDER.filter((f) => facetValues(filters, f).length === 0);
  const inactiveFields = customFields.filter(
    (f) => (filters.fieldValues[f.id] ?? []).length === 0,
  );
  const activeCount = activeFacetCount(filters);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          variant === "add" ? (
            <button
              type="button"
              aria-label="Add filter"
              className="btn btn-sm btn-ghost"
            />
          ) : (
            <button
              type="button"
              aria-label="Add filter"
              title="Add filter"
              className={cn("btn btn-ghost", activeCount > 0 && "on")}
            />
          )
        }
      >
        {variant === "add" ? (
          <>
            <Plus className="i" size={12} strokeWidth={1.8} aria-hidden />
            Add
          </>
        ) : (
          <>
            <ListFilter className="i" size={14} strokeWidth={1.8} aria-hidden />
            Filter
            {activeCount > 0 ? (
              <span
                className="badge accent"
                style={{ height: 16, padding: "0 5px" }}
              >
                {activeCount}
              </span>
            ) : null}
          </>
        )}
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
            {inactiveFields.length > 0 ? (
              <CommandGroup heading="Custom fields">
                {inactiveFields.map((field) => {
                  const Icon = FIELD_TYPE_ICON[field.type];
                  return (
                    <CommandItem
                      key={field.id}
                      value={`${field.name} field`}
                      onSelect={() => {
                        onPick(fieldFacetKey(field.id));
                        setOpen(false);
                      }}
                      className="gap-2"
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{field.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
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
  onPick,
}: {
  propertyId: string;
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  currentUserId: string;
  addedFacet: FacetKey | null;
  onResolveAdded: () => void;
  /** Adds another facet from the bar's "+ Add" (the board's handler). */
  onPick?: (facet: FacetKey) => void;
}) {
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: labels = [] } = useQuery(labelsQueryOptions(propertyId));
  const { data: customFields = [] } = useQuery(
    customFieldsQueryOptions(propertyId),
  );
  const { data: cyclesPayload } = useQuery(cyclesQueryOptions(propertyId));
  const catalog = useStatusCatalog(propertyId);

  const cycles = useMemo(() => {
    const list = cyclesPayload?.cycles ?? [];
    const teamName = (id: string | null) =>
      id ? (spaces.find((s) => s.id === id)?.name ?? "Team") : "Property";
    // Current first, then upcoming, then the most recent finished ones.
    const rank = { current: 0, upcoming: 1, past: 2 } as const;
    return [...list]
      .sort(
        (a, b) =>
          rank[a.phase] - rank[b.phase] ||
          (a.phase === "past"
            ? b.starts_on.localeCompare(a.starts_on)
            : a.starts_on.localeCompare(b.starts_on)),
      )
      .filter((c, i, arr) => c.phase !== "past" || arr.indexOf(c) < 40)
      .map((c) => ({
        id: c.id,
        label: `${teamName(c.space_id)} · ${cycleLabel(c)}`,
        current: c.phase === "current",
      }));
  }, [cyclesPayload, spaces]);

  const data: FacetData = useMemo(
    () => ({ members, spaces, projects, labels, cycles, customFields, catalog }),
    [members, spaces, projects, labels, cycles, customFields, catalog],
  );

  const active: FacetKey[] = [
    ...FACET_ORDER.filter((f) => facetValues(filters, f).length > 0),
    ...activeFieldFacets(filters),
  ];
  const shown =
    addedFacet && !active.includes(addedFacet) ? [...active, addedFacet] : active;

  if (shown.length === 0) return null;

  return (
    // gr8r `.chipsbar`: filter glyph, one `.chip` per facet joined by "and",
    // "+ Add", then "Clear all" pushed right.
    <div className="chipsbar">
      <ListFilter className="i" size={13} strokeWidth={1.8} aria-hidden />
      {shown.map((facet, i) => (
        <Fragment key={facet}>
          {i > 0 ? <span>and</span> : null}
          <FacetControl
            facet={facet}
            filters={filters}
            onChange={onChange}
            currentUserId={currentUserId}
            data={data}
            autoOpen={facet === addedFacet}
            onEmptyClose={onResolveAdded}
          />
        </Fragment>
      ))}
      {onPick ? (
        <FilterMenu
          filters={filters}
          onPick={onPick}
          customFields={customFields}
          variant="add"
        />
      ) : null}
      <span className="sp" />
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => {
          onChange(clearFacets(filters));
          onResolveAdded();
        }}
      >
        Clear all
      </button>
    </div>
  );
}
