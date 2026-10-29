"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRightLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  Diamond,
  FolderInput,
  Gauge,
  Inbox,
  Megaphone,
  Pencil,
  Plus,
  RotateCcw,
  SignalHigh,
  Tag,
  Target,
  Timer,
  Trash2,
  UserMinus,
  UserPlus,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Eyebrow } from "@/components/ui/eyebrow";
import { EmptyState } from "@/components/ui/empty-state";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect } from "@/components/ui/native-select";
import {
  propertyMembersQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { statusCatalogQueryOptions } from "@/lib/query/status-queries";
import {
  activityLogQueryOptions,
  matchesFamily,
  type ActivityFamily,
  type ActivityLogRow,
  type ActivityScope,
} from "@/lib/query/activity-log-queries";
import { taskHref } from "@/lib/tasks/task-href";
import { COLUMNS, PRIORITY_META } from "@/components/tasks/kanban";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

const TASK_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.label]),
);
const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  planned: "Planned",
  completed: "Completed",
  archived: "Archived",
};

const UPDATE_HEALTH_LABEL: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

function statusLabel(kind: ActivityLogRow["entity_kind"], v: unknown) {
  if (typeof v !== "string") return "—";
  // Initiatives share the project vocabulary (planned / active / completed).
  return kind === "project" || kind === "initiative"
    ? (PROJECT_STATUS_LABEL[v] ?? v)
    : (TASK_STATUS_LABEL[v as TaskStatus] ?? v);
}

function priorityLabel(v: unknown) {
  if (typeof v !== "string") return "—";
  return PRIORITY_META[v as TaskPriority]?.label ?? v;
}

function shortDate(v: unknown) {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Compact relative time: just now, 5m, 3h, 2d, then a short date. */
export function activityTimeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* -------------------------------------------------------------------------- */
/* Lookups the sentence needs                                                 */
/* -------------------------------------------------------------------------- */

export type ActivityLookup = {
  propertyId: string;
  /** The viewer — rows by them read "You". */
  meId?: string | null;
  members: Map<string, PropertyMember>;
  projects: Map<string, { id: string; name: string }>;
  spaces: Map<string, { id: string; name: string }>;
  /** Lists (0114) — `list_changed` rows carry list ids. */
  lists: Map<string, { id: string; name: string }>;
};

export function useActivityLookup(propertyId: string, meId?: string | null): ActivityLookup {
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: catalog } = useQuery(statusCatalogQueryOptions(propertyId));
  const lists = catalog?.lists;
  return useMemo(
    () => ({
      propertyId,
      meId,
      members: new Map(members.map((m) => [m.id, m])),
      projects: new Map(projects.map((p) => [p.id, { id: p.id, name: p.name }])),
      spaces: new Map(spaces.map((s) => [s.id, { id: s.id, name: s.name }])),
      lists: new Map((lists ?? []).map((l) => [l.id, { id: l.id, name: l.name }])),
    }),
    [propertyId, meId, members, projects, spaces, lists],
  );
}

/* -------------------------------------------------------------------------- */
/* Describe one row                                                            */
/* -------------------------------------------------------------------------- */

export type ActivityDescription = {
  Icon: LucideIcon;
  /** "You" / "Sarah Chen" / "Workflow" / "AI" / "Someone". */
  actor: string;
  actorMember: PropertyMember | null;
  /** The verb phrase, e.g. "moved". */
  verb: string;
  /** The thing acted on, as a link when it still resolves. */
  object: { label: string; href: string | null } | null;
  /** Trailing detail, e.g. "to Review" / "to Sarah Chen". */
  extra: string | null;
  /** Project the row sits in — shown as "in <project>" on cross-project feeds. */
  project: { id: string; name: string } | null;
};

export function describeActivity(
  row: ActivityLogRow,
  L: ActivityLookup,
): ActivityDescription {
  const d = row.detail ?? {};
  const member = row.actor_id ? (L.members.get(row.actor_id) ?? null) : null;
  const actor =
    row.actor_id && row.actor_id === L.meId
      ? "You"
      : member?.name ||
        (row.actor_kind === "workflow"
          ? "A workflow"
          : row.actor_kind === "ai"
            ? "The AI"
            : row.actor_kind === "system"
              ? "System"
              : "Someone");
  const personName = (id: unknown) =>
    typeof id === "string" ? (L.members.get(id)?.name ?? "someone") : "nobody";
  const projectName = (id: unknown) =>
    typeof id === "string" ? (L.projects.get(id)?.name ?? "a project") : null;
  const spaceName = (id: unknown) =>
    typeof id === "string" ? (L.spaces.get(id)?.name ?? "a team") : null;

  const project = row.project_id ? (L.projects.get(row.project_id) ?? null) : null;
  const title =
    row.entity_title ??
    (row.entity_kind === "task"
      ? "a task"
      : row.entity_kind === "initiative"
        ? "an initiative"
        : "a project");

  const taskObj = {
    label: title,
    href: row.verb === "deleted" ? null : taskHref(L.propertyId, row.entity_id),
  };
  const projectObj = {
    label: title,
    href: row.verb === "deleted" ? null : `/p/${L.propertyId}/projects/${row.entity_id}`,
  };
  const initiativeObj = {
    label: title,
    href: row.verb === "deleted" ? null : `/p/${L.propertyId}/initiatives/${row.entity_id}`,
  };
  const healthExtra =
    typeof d.health === "string" ? `— ${UPDATE_HEALTH_LABEL[d.health] ?? d.health}` : null;
  const milestoneObj = {
    label: title,
    href: row.project_id ? `/p/${L.propertyId}/projects/${row.project_id}` : null,
  };

  const base = { actor, actorMember: member, project, extra: null as string | null };

  if (row.entity_kind === "project") {
    switch (row.verb) {
      case "created":
        return { ...base, Icon: Plus, verb: "created project", object: projectObj };
      case "deleted":
        return { ...base, Icon: Trash2, verb: "deleted project", object: projectObj };
      case "status_changed":
        return {
          ...base,
          Icon: ArrowRightLeft,
          verb: "set",
          object: projectObj,
          extra: `to ${statusLabel("project", d.to)}`,
        };
      case "renamed":
        return {
          ...base,
          Icon: Pencil,
          verb: "renamed",
          object: { ...projectObj, label: String(d.from ?? title) },
          extra: `to “${String(d.to ?? title)}”`,
        };
      case "description_changed":
        return { ...base, Icon: Pencil, verb: "edited the description of", object: projectObj };
      case "dates_changed": {
        const s = shortDate(d.to_start);
        const t = shortDate(d.to_target);
        return {
          ...base,
          Icon: CalendarClock,
          verb: "changed the dates of",
          object: projectObj,
          extra: s || t ? `to ${s ?? "—"} → ${t ?? "—"}` : "(cleared)",
        };
      }
      case "lead_changed":
        return {
          ...base,
          Icon: UserPlus,
          verb: d.to ? "made" : "removed the lead of",
          object: projectObj,
          extra: d.to ? `led by ${personName(d.to)}` : null,
        };
      case "archived":
        return { ...base, Icon: Trash2, verb: "archived project", object: projectObj };
      case "restored":
        return { ...base, Icon: RotateCcw, verb: "restored project", object: projectObj };
      case "update_posted":
        return {
          ...base,
          Icon: Megaphone,
          verb: "posted an update on",
          object: projectObj,
          extra: healthExtra,
        };
      default:
        return { ...base, Icon: Activity, verb: "updated project", object: projectObj };
    }
  }

  if (row.entity_kind === "initiative") {
    switch (row.verb) {
      case "created":
        return { ...base, Icon: Target, verb: "created initiative", object: initiativeObj };
      case "status_changed":
        return {
          ...base,
          Icon: ArrowRightLeft,
          verb: "set",
          object: initiativeObj,
          extra: `to ${statusLabel("initiative", d.to)}`,
        };
      case "dates_changed": {
        const t = shortDate(d.to);
        return {
          ...base,
          Icon: CalendarClock,
          verb: t ? "set the target of" : "cleared the target of",
          object: initiativeObj,
          extra: t ? `to ${t}` : null,
        };
      }
      case "lead_changed":
        return {
          ...base,
          Icon: UserPlus,
          verb: d.to ? "handed" : "removed the owner of",
          object: initiativeObj,
          extra: d.to ? `to ${d.to === L.meId ? "you" : personName(d.to)}` : null,
        };
      case "archived":
        return { ...base, Icon: Trash2, verb: "archived initiative", object: initiativeObj };
      case "unarchived":
        return { ...base, Icon: RotateCcw, verb: "restored initiative", object: initiativeObj };
      case "update_posted":
        return {
          ...base,
          Icon: Megaphone,
          verb: "posted an update on",
          object: initiativeObj,
          extra: healthExtra,
        };
      default:
        return { ...base, Icon: Target, verb: "updated initiative", object: initiativeObj };
    }
  }

  if (row.entity_kind === "cycle") {
    // Cycles (0111) are owned by the cycles surface; render generically.
    return {
      ...base,
      Icon: Timer,
      verb: row.verb.replace(/_/g, " "),
      object: { label: title, href: `/p/${L.propertyId}/cycles` },
    };
  }

  if (row.entity_kind === "milestone") {
    switch (row.verb) {
      case "milestone_added":
        return {
          ...base,
          Icon: Diamond,
          verb: "added milestone",
          object: milestoneObj,
          extra: shortDate(d.due_date) ? `for ${shortDate(d.due_date)}` : null,
        };
      case "milestone_completed":
        return { ...base, Icon: CheckCircle2, verb: "reached milestone", object: milestoneObj };
      case "milestone_reopened":
        return { ...base, Icon: RotateCcw, verb: "reopened milestone", object: milestoneObj };
      case "milestone_removed":
        return { ...base, Icon: Trash2, verb: "removed milestone", object: { ...milestoneObj, href: null } };
      case "milestone_changed": {
        const due = shortDate(d.to_due);
        return {
          ...base,
          Icon: Pencil,
          verb: "changed milestone",
          object: milestoneObj,
          extra: due && d.from_due !== d.to_due ? `to ${due}` : null,
        };
      }
      default:
        return { ...base, Icon: Diamond, verb: "updated milestone", object: milestoneObj };
    }
  }

  // Tasks
  switch (row.verb) {
    case "created":
      return { ...base, Icon: Plus, verb: "created", object: taskObj };
    case "deleted":
      return { ...base, Icon: Trash2, verb: "deleted", object: taskObj };
    case "completed":
      return { ...base, Icon: CheckCircle2, verb: "completed", object: taskObj };
    case "reopened":
      return {
        ...base,
        Icon: RotateCcw,
        verb: "reopened",
        object: taskObj,
        extra:
          typeof d.to_name === "string"
            ? `as ${d.to_name}`
            : d.to !== "todo"
              ? `as ${statusLabel("task", d.to)}`
              : null,
      };
    case "status_changed":
      return {
        ...base,
        Icon: ArrowRightLeft,
        verb: "moved",
        object: taskObj,
        // 0114 rows carry the list's own status names; older rows only the
        // legacy literal.
        extra: `to ${typeof d.to_name === "string" ? d.to_name : statusLabel("task", d.to)}`,
      };
    case "list_changed":
      return {
        ...base,
        Icon: ArrowRightLeft,
        verb: "moved",
        object: taskObj,
        extra: (() => {
          const name = typeof d.to === "string" ? L.lists.get(d.to)?.name : undefined;
          return name ? `to the ${name} list` : "to another list";
        })(),
      };
    case "priority_changed":
      return {
        ...base,
        Icon: SignalHigh,
        verb: "set priority of",
        object: taskObj,
        extra: `to ${priorityLabel(d.to)}`,
      };
    case "assigned":
      return {
        ...base,
        Icon: UserPlus,
        verb: "assigned",
        object: taskObj,
        extra: `to ${d.to === L.meId ? "you" : personName(d.to)}`,
      };
    case "unassigned":
      return { ...base, Icon: UserMinus, verb: "unassigned", object: taskObj };
    case "due_changed": {
      const to = shortDate(d.to);
      return {
        ...base,
        Icon: CalendarClock,
        verb: to ? "set the due date of" : "cleared the due date of",
        object: taskObj,
        extra: to ? `to ${to}` : null,
      };
    }
    case "scheduled": {
      const s = shortDate(d.to_start);
      return {
        ...base,
        Icon: CalendarClock,
        verb: s ? "scheduled" : "unscheduled",
        object: taskObj,
        extra: s
          ? `for ${s}${shortDate(d.to_end) && shortDate(d.to_end) !== s ? ` → ${shortDate(d.to_end)}` : ""}`
          : null,
      };
    }
    case "renamed":
      return {
        ...base,
        Icon: Pencil,
        verb: "renamed",
        object: { ...taskObj, label: String(d.from ?? title) },
        extra: `to “${String(d.to ?? title)}”`,
      };
    case "description_changed":
      return { ...base, Icon: Pencil, verb: "edited the description of", object: taskObj };
    case "labels_changed": {
      const added = Array.isArray(d.added) ? (d.added as string[]) : [];
      const removed = Array.isArray(d.removed) ? (d.removed as string[]) : [];
      const parts: string[] = [];
      if (added.length) parts.push(`added ${added.join(", ")}`);
      if (removed.length) parts.push(`removed ${removed.join(", ")}`);
      return {
        ...base,
        Icon: Tag,
        verb: "changed labels on",
        object: taskObj,
        extra: parts.length ? `(${parts.join("; ")})` : null,
      };
    }
    case "project_changed": {
      const to = projectName(d.to);
      return {
        ...base,
        Icon: FolderInput,
        verb: to ? "added" : "removed",
        object: taskObj,
        extra: to ? `to ${to}` : "from its project",
      };
    }
    case "project_removed":
      return {
        ...base,
        Icon: FolderInput,
        verb: "moved",
        object: taskObj,
        extra: projectName(d.to) ? `to ${projectName(d.to)}` : "out of this project",
      };
    case "space_changed": {
      const to = spaceName(d.to);
      return {
        ...base,
        Icon: FolderInput,
        verb: to ? "moved" : "removed",
        object: taskObj,
        extra: to ? `to ${to}` : "from its team",
      };
    }
    case "estimate_changed":
      return {
        ...base,
        Icon: Gauge,
        verb: typeof d.to === "number" ? "estimated" : "cleared the estimate of",
        object: taskObj,
        extra:
          typeof d.to === "number" ? `at ${d.to} ${d.to === 1 ? "point" : "points"}` : null,
      };
    case "cycle_changed":
      return {
        ...base,
        Icon: Timer,
        verb: d.to ? "moved" : "removed",
        object: taskObj,
        extra: d.to ? (d.from ? "to another cycle" : "into a cycle") : "from its cycle",
      };
    case "milestone_changed":
      return {
        ...base,
        Icon: Diamond,
        verb: d.to ? "set the milestone of" : "cleared the milestone of",
        object: taskObj,
      };
    case "triage_queued":
      return { ...base, Icon: Inbox, verb: "sent", object: taskObj, extra: "to triage" };
    case "triage_accepted":
      return {
        ...base,
        Icon: CheckCircle2,
        verb: "accepted",
        object: taskObj,
        extra: "from triage",
      };
    case "triage_declined":
      return {
        ...base,
        Icon: XCircle,
        verb: "declined",
        object: taskObj,
        extra: typeof d.note === "string" && d.note ? `— “${d.note}”` : "in triage",
      };
    case "parent_changed":
      return {
        ...base,
        Icon: FolderInput,
        verb: d.to ? "made" : "detached",
        object: taskObj,
        extra: d.to ? "a sub-issue" : "from its parent",
      };
    default:
      return { ...base, Icon: Activity, verb: "updated", object: taskObj };
  }
}

/* -------------------------------------------------------------------------- */
/* Viewer                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The signed-in user's id, for "You" attribution. Surfaces that already know
 * the viewer pass `meId` directly; the project/space/task pages don't carry
 * it, so this reads it once from the browser session and caches it.
 */
export function useViewerId(): string | null {
  const { data } = useQuery({
    queryKey: ["viewer-id"] as const,
    staleTime: Infinity,
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });
  return data ?? null;
}

/* -------------------------------------------------------------------------- */
/* Realtime                                                                   */
/* -------------------------------------------------------------------------- */

/** Invalidate every activity-log query for the property when a row lands. */
export function useActivityLogRealtime(propertyId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!propertyId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`activity-log:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_log",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["activity-log", propertyId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function ActorAvatar({
  desc,
  kind,
  size = "md",
}: {
  desc: ActivityDescription;
  kind: ActivityLogRow["actor_kind"];
  size?: "sm" | "md";
}) {
  const cls = size === "sm" ? "size-5 text-[10px]" : "size-6 text-[11px]";
  if (desc.actorMember) {
    return (
      <Avatar className={cn(cls, "shrink-0")}>
        {desc.actorMember.avatarUrl ? (
          <AvatarImage src={desc.actorMember.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback className="bg-accent-pressed font-medium text-secondary-ink">
          {initials(desc.actorMember.name ?? "?")}
        </AvatarFallback>
      </Avatar>
    );
  }
  const Glyph = kind === "workflow" ? Zap : kind === "ai" ? Bot : desc.Icon;
  return (
    <span
      className={cn(
        cls,
        "inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-faint-foreground [&_svg]:size-3",
      )}
      aria-hidden="true"
    >
      <Glyph strokeWidth={1.75} />
    </span>
  );
}

function ObjectLink({ object }: { object: ActivityDescription["object"] }) {
  if (!object) return null;
  if (!object.href)
    return <span className="font-medium text-foreground">{object.label}</span>;
  return (
    <Link
      href={object.href}
      className="font-medium text-foreground underline-offset-2 hover:underline"
    >
      {object.label}
    </Link>
  );
}

/**
 * One activity sentence: avatar · **Actor** verb *Object* extra · time.
 * `showProject` appends "in <project>" for feeds that span projects.
 */
export function ActivityLogItem({
  row,
  lookup,
  showProject,
  dense,
}: {
  row: ActivityLogRow;
  lookup: ActivityLookup;
  showProject?: boolean;
  dense?: boolean;
}) {
  const desc = describeActivity(row, lookup);
  return (
    <li
      className={cn(
        "flex items-start gap-2.5",
        dense ? "py-1" : "min-h-[37px] py-2",
      )}
    >
      <span className={dense ? "mt-px" : "mt-0.5"}>
        <ActorAvatar desc={desc} kind={row.actor_kind} size={dense ? "sm" : "md"} />
      </span>
      <p className="min-w-0 flex-1 text-sm leading-5 text-muted-foreground">
        <span className="font-medium text-foreground">{desc.actor}</span> {desc.verb}{" "}
        <ObjectLink object={desc.object} />
        {desc.extra ? <> {desc.extra}</> : null}
        {showProject && desc.project && row.entity_kind !== "project" ? (
          <>
            {" "}
            <span className="text-faint-foreground">
              in{" "}
              <Link
                href={`/p/${lookup.propertyId}/projects/${desc.project.id}`}
                className="hover:text-foreground"
              >
                {desc.project.name}
              </Link>
            </span>
          </>
        ) : null}
      </p>
      <time
        dateTime={row.created_at}
        title={new Date(row.created_at).toLocaleString()}
        className="shrink-0 pt-px text-xs tabular-nums text-faint-foreground"
      >
        {activityTimeAgo(row.created_at)}
      </time>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Day buckets                                                                */
/* -------------------------------------------------------------------------- */

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)
    return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function groupActivityByDay(rows: ActivityLogRow[]) {
  const out: { key: string; label: string; rows: ActivityLogRow[] }[] = [];
  for (const r of rows) {
    const key = r.created_at.slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else out.push({ key, label: dayLabel(r.created_at), rows: [r] });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Compact feed (rails, task history)                                         */
/* -------------------------------------------------------------------------- */

export function ActivityLogList({
  rows,
  lookup,
  pending,
  showProject,
  dense,
  emptyText = "No activity yet — changes will show here as work moves.",
}: {
  rows: ActivityLogRow[];
  lookup: ActivityLookup;
  pending?: boolean;
  showProject?: boolean;
  dense?: boolean;
  emptyText?: string;
}) {
  if (pending && rows.length === 0)
    return <p className="py-1 text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0)
    return <p className="py-1 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul role="list" className={cn("flex flex-col", dense ? "gap-0.5" : "divide-y divide-border")}>
      {rows.map((r) => (
        <ActivityLogItem key={r.id} row={r} lookup={lookup} showProject={showProject} dense={dense} />
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Full feed with filters (workspace page, project/space Activity tabs)       */
/* -------------------------------------------------------------------------- */

const FAMILIES: { id: ActivityFamily; label: string }[] = [
  { id: "all", label: "All" },
  { id: "status", label: "Status" },
  { id: "assignments", label: "Assignments" },
  { id: "dates", label: "Dates" },
  { id: "created", label: "Created" },
  { id: "projects", label: "Projects" },
];

export function ActivityLogFeed({
  propertyId,
  scope,
  meId,
  showProject = scope.kind !== "project",
  showPersonFilter = true,
  limit,
  className,
}: {
  propertyId: string;
  scope: ActivityScope;
  meId?: string | null;
  showProject?: boolean;
  showPersonFilter?: boolean;
  limit?: number;
  className?: string;
}) {
  const lookup = useActivityLookup(propertyId, meId);
  useActivityLogRealtime(propertyId);
  const { data: rows = [], isPending } = useQuery(
    activityLogQueryOptions(propertyId, scope, limit),
  );
  const [family, setFamily] = useState<ActivityFamily>("all");
  const [who, setWho] = useState<string>("all");

  const people = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) if (r.actor_id) ids.add(r.actor_id);
    return [...ids]
      .map((id) => lookup.members.get(id))
      .filter((m): m is PropertyMember => Boolean(m))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [rows, lookup.members]);

  const visible = useMemo(
    () =>
      rows.filter(
        (r) => matchesFamily(r, family) && (who === "all" || r.actor_id === who),
      ),
    [rows, family, who],
  );
  const groups = useMemo(() => groupActivityByDay(visible), [visible]);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          value={[family]}
          onValueChange={(v) => {
            const next = (v as ActivityFamily[])[0];
            if (next) setFamily(next);
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Filter by kind"
        >
          {FAMILIES.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} aria-label={f.label}>
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {showPersonFilter && people.length > 0 ? (
          <NativeSelect
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label="Filter by person"
            className="h-8 w-auto text-sm"
          >
            <option value="all">Everyone</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === meId ? `${m.name ?? "You"} (you)` : m.name ?? m.email ?? "Member"}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <span className="ml-auto text-sm tabular-nums text-faint-foreground">
          {visible.length === rows.length
            ? `${rows.length} ${rows.length === 1 ? "change" : "changes"}`
            : `${visible.length} of ${rows.length}`}
        </span>
      </div>

      {isPending && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={rows.length === 0 ? "No activity yet" : "Nothing matches these filters"}
        >
          {rows.length === 0
            ? "Changes to tasks, projects and milestones will appear here, with who made them."
            : "Try a different kind or person."}
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-1">
            <Eyebrow className="px-0.5">{g.label}</Eyebrow>
            <ul role="list" className="flex flex-col divide-y divide-border">
              {g.rows.map((r) => (
                <ActivityLogItem key={r.id} row={r} lookup={lookup} showProject={showProject} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
