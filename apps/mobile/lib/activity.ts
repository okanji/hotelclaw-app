import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { ApiMember } from "./api";
import { PRIORITY_LABEL, STATUS_LABEL } from "../components/ui";

/**
 * The actor-aware change log (`activity_log`, migration 0106) on the phone.
 * Read straight from Supabase under RLS (member SELECT) and kept live over
 * Realtime, exactly like `assistant_chats` — these are reference reads with
 * no side effects, so they don't need the web API. The sentence vocabulary
 * mirrors `apps/web/components/activity/activity-log.tsx` (`describeActivity`);
 * keep the two in step when a verb is added.
 */
export type ActivityRow = {
  id: string;
  property_id: string;
  actor_id: string | null;
  actor_kind: "user" | "system" | "workflow" | "ai";
  entity_kind: "task" | "project" | "milestone";
  entity_id: string;
  entity_title: string | null;
  verb: string;
  detail: Record<string, unknown>;
  project_id: string | null;
  space_id: string | null;
  created_at: string;
};

export type ActivityScope =
  | { kind: "property" }
  | { kind: "project"; id: string }
  | { kind: "task"; id: string };

export type ActivityFamily = "all" | "status" | "assignments" | "dates" | "created" | "projects";

export const FAMILIES: { id: ActivityFamily; label: string }[] = [
  { id: "all", label: "All" },
  { id: "status", label: "Status" },
  { id: "assignments", label: "Assigned" },
  { id: "dates", label: "Dates" },
  { id: "created", label: "Created" },
  { id: "projects", label: "Projects" },
];

/** Same mapping as web's `matchesFamily` — the filter chips must agree. */
export function matchesFamily(row: ActivityRow, family: ActivityFamily): boolean {
  switch (family) {
    case "all":
      return true;
    case "status":
      return (
        row.entity_kind === "task" &&
        ["status_changed", "completed", "reopened", "priority_changed"].includes(row.verb)
      );
    case "assignments":
      return row.verb === "assigned" || row.verb === "unassigned";
    case "dates":
      return (
        ["due_changed", "scheduled", "dates_changed"].includes(row.verb) ||
        row.verb.startsWith("milestone_")
      );
    case "created":
      return row.verb === "created" || row.verb === "deleted";
    case "projects":
      return (
        row.entity_kind === "project" ||
        row.entity_kind === "milestone" ||
        row.verb === "project_changed" ||
        row.verb === "project_removed"
      );
  }
}

const SELECT =
  "id, property_id, actor_id, actor_kind, entity_kind, entity_id, entity_title, verb, detail, project_id, space_id, created_at";

export function useActivityLog(
  propertyId: string | undefined,
  scope: ActivityScope,
  limit = 150,
) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scopeKey = scope.kind === "property" ? "property" : `${scope.kind}:${scope.id}`;

  const load = useCallback(async () => {
    if (!propertyId) return;
    let q = supabase
      .from("activity_log")
      .select(SELECT)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (scope.kind === "project") q = q.eq("project_id", scope.id);
    if (scope.kind === "task") q = q.eq("entity_id", scope.id);
    const { data, error: err } = await q;
    if (err) setError(err.message);
    else {
      setError(null);
      setRows((data ?? []) as ActivityRow[]);
    }
    // scopeKey stands in for the scope object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, scopeKey, limit]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setRows(null);
      return load();
    });
  }, [load]);

  useEffect(() => {
    if (!propertyId) return;
    const channel = supabase
      .channel(`activity-log-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_log",
          filter: `property_id=eq.${propertyId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, propertyId]);

  return { rows, error, reload: load };
}

/* ── Describing a row ────────────────────────────────────────────────────── */

export type ActivityLookup = {
  meId: string | null;
  members: Map<string, ApiMember>;
  projects: Map<string, string>;
  spaces: Map<string, string>;
};

/** Build the lookup once from the screen's member + catalogue data. */
export function useActivityLookup(
  meId: string | null | undefined,
  members: ApiMember[] | null | undefined,
  projects: { id: string; name: string }[] | undefined,
  spaces: { id: string; name: string }[] | undefined,
): ActivityLookup {
  return useMemo(
    () => ({
      meId: meId ?? null,
      members: new Map((members ?? []).map((m) => [m.id, m])),
      projects: new Map((projects ?? []).map((p) => [p.id, p.name])),
      spaces: new Map((spaces ?? []).map((s) => [s.id, s.name])),
    }),
    [meId, members, projects, spaces],
  );
}

export type ActivityDescription = {
  actor: string;
  actorInitialsFrom: string | null;
  verb: string;
  object: string;
  extra: string | null;
  /** Where tapping the row goes. */
  target:
    | { kind: "task"; id: string }
    | { kind: "project"; id: string }
    | null;
  project: { id: string; name: string } | null;
};

const PROJECT_STATUS: Record<string, string> = {
  active: "Active",
  planned: "Planned",
  completed: "Completed",
  archived: "Archived",
};

function shortDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function describeActivity(row: ActivityRow, L: ActivityLookup): ActivityDescription {
  const d = row.detail ?? {};
  const member = row.actor_id ? L.members.get(row.actor_id) : undefined;
  const actor =
    row.actor_id && row.actor_id === L.meId
      ? "You"
      : member?.name ||
        member?.email ||
        (row.actor_kind === "workflow"
          ? "A workflow"
          : row.actor_kind === "ai"
            ? "The AI"
            : row.actor_kind === "system"
              ? "System"
              : "Someone");
  const person = (id: unknown) =>
    typeof id === "string"
      ? id === L.meId
        ? "you"
        : (L.members.get(id)?.name ?? "someone")
      : "nobody";
  const title = row.entity_title ?? (row.entity_kind === "task" ? "a task" : "a project");
  const project = row.project_id
    ? { id: row.project_id, name: L.projects.get(row.project_id) ?? "a project" }
    : null;
  const deleted = row.verb === "deleted" || row.verb === "milestone_removed";
  const target: ActivityDescription["target"] = deleted
    ? null
    : row.entity_kind === "task"
      ? { kind: "task", id: row.entity_id }
      : row.entity_kind === "project"
        ? { kind: "project", id: row.entity_id }
        : row.project_id
          ? { kind: "project", id: row.project_id }
          : null;
  const base = {
    actor,
    actorInitialsFrom: member?.name ?? null,
    object: title,
    extra: null as string | null,
    target,
    project,
  };
  const s = (v: unknown) => (typeof v === "string" ? v : "");

  if (row.entity_kind === "project") {
    switch (row.verb) {
      case "created":
        return { ...base, verb: "created project" };
      case "deleted":
        return { ...base, verb: "deleted project" };
      case "status_changed":
        return { ...base, verb: "set", extra: `to ${PROJECT_STATUS[s(d.to)] ?? s(d.to)}` };
      case "renamed":
        return { ...base, verb: "renamed", object: s(d.from) || title, extra: `to “${s(d.to) || title}”` };
      case "description_changed":
        return { ...base, verb: "edited the description of" };
      case "dates_changed": {
        const a = shortDate(d.to_start);
        const b = shortDate(d.to_target);
        return { ...base, verb: "changed the dates of", extra: a || b ? `to ${a ?? "—"} → ${b ?? "—"}` : "(cleared)" };
      }
      case "lead_changed":
        return d.to
          ? { ...base, verb: "made", extra: `led by ${person(d.to)}` }
          : { ...base, verb: "removed the lead of" };
      case "archived":
        return { ...base, verb: "archived project" };
      case "restored":
        return { ...base, verb: "restored project" };
      default:
        return { ...base, verb: "updated project" };
    }
  }

  if (row.entity_kind === "milestone") {
    switch (row.verb) {
      case "milestone_added":
        return { ...base, verb: "added milestone", extra: shortDate(d.due_date) ? `for ${shortDate(d.due_date)}` : null };
      case "milestone_completed":
        return { ...base, verb: "reached milestone" };
      case "milestone_reopened":
        return { ...base, verb: "reopened milestone" };
      case "milestone_removed":
        return { ...base, verb: "removed milestone" };
      case "milestone_changed": {
        const due = shortDate(d.to_due);
        return { ...base, verb: "changed milestone", extra: due && d.from_due !== d.to_due ? `to ${due}` : null };
      }
      default:
        return { ...base, verb: "updated milestone" };
    }
  }

  switch (row.verb) {
    case "created":
      return { ...base, verb: "created" };
    case "deleted":
      return { ...base, verb: "deleted" };
    case "completed":
      return { ...base, verb: "completed" };
    case "reopened":
      return { ...base, verb: "reopened", extra: d.to !== "todo" ? `as ${STATUS_LABEL[s(d.to) as keyof typeof STATUS_LABEL] ?? s(d.to)}` : null };
    case "status_changed":
      return { ...base, verb: "moved", extra: `to ${STATUS_LABEL[s(d.to) as keyof typeof STATUS_LABEL] ?? s(d.to)}` };
    case "priority_changed":
      return { ...base, verb: "set priority of", extra: `to ${PRIORITY_LABEL[s(d.to) as keyof typeof PRIORITY_LABEL] ?? s(d.to)}` };
    case "assigned":
      return { ...base, verb: "assigned", extra: `to ${person(d.to)}` };
    case "unassigned":
      return { ...base, verb: "unassigned" };
    case "due_changed": {
      const to = shortDate(d.to);
      return to
        ? { ...base, verb: "set the due date of", extra: `to ${to}` }
        : { ...base, verb: "cleared the due date of" };
    }
    case "scheduled": {
      const a = shortDate(d.to_start);
      const b = shortDate(d.to_end);
      return a
        ? { ...base, verb: "scheduled", extra: `for ${a}${b && b !== a ? ` → ${b}` : ""}` }
        : { ...base, verb: "unscheduled" };
    }
    case "renamed":
      return { ...base, verb: "renamed", object: s(d.from) || title, extra: `to “${s(d.to) || title}”` };
    case "description_changed":
      return { ...base, verb: "edited the description of" };
    case "labels_changed": {
      const added = Array.isArray(d.added) ? (d.added as string[]) : [];
      const removed = Array.isArray(d.removed) ? (d.removed as string[]) : [];
      const parts: string[] = [];
      if (added.length) parts.push(`added ${added.join(", ")}`);
      if (removed.length) parts.push(`removed ${removed.join(", ")}`);
      return { ...base, verb: "changed labels on", extra: parts.length ? `(${parts.join("; ")})` : null };
    }
    case "project_changed": {
      const to = typeof d.to === "string" ? (L.projects.get(d.to) ?? "a project") : null;
      return to ? { ...base, verb: "added", extra: `to ${to}` } : { ...base, verb: "removed", extra: "from its project" };
    }
    case "project_removed": {
      const to = typeof d.to === "string" ? (L.projects.get(d.to) ?? "a project") : null;
      return { ...base, verb: "moved", extra: to ? `to ${to}` : "out of this project" };
    }
    case "space_changed": {
      const to = typeof d.to === "string" ? (L.spaces.get(d.to) ?? "a team") : null;
      return to ? { ...base, verb: "moved", extra: `to ${to}` } : { ...base, verb: "removed", extra: "from its team" };
    }
    case "parent_changed":
      return d.to ? { ...base, verb: "made", extra: "a sub-issue" } : { ...base, verb: "detached", extra: "from its parent" };
    default:
      return { ...base, verb: "updated" };
  }
}

/** just now · 5m · 3h · 2d · Oct 12 */
export function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
