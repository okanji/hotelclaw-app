import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { TaskStatus } from "./api";

/**
 * Projects on the phone — reference reads straight from Supabase under RLS
 * (the same tables web's `projectsTrackingQueryOptions` reads), rolled up
 * client-side. Milestone writes also go direct: `project_milestones` has a
 * member-wide policy and the `activity_log` trigger attributes the change to
 * `auth.uid()`, so there's no server action to mirror.
 */
export type ProjectStatus = "active" | "planned" | "completed" | "archived";

export type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  status: ProjectStatus;
  start_date: string | null;
  target_date: string | null;
  lead_user_id: string | null;
  created_at: string;
};

export type ProjectSummary = ProjectRow & {
  total: number;
  done: number;
  counts: Record<TaskStatus, number>;
};

export type ProjectTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  assignee_id: string | null;
  due_at: string | null;
  position: number;
};

export type Milestone = {
  id: string;
  project_id: string;
  name: string;
  due_date: string;
  completed_at: string | null;
  position: number;
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  planned: "Planned",
  completed: "Completed",
  archived: "Archived",
};

export const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  active: "#16a34a",
  planned: "#2563eb",
  completed: "#7c3aed",
  archived: "#9ca3af",
};

/** The six entity hues web's `LABEL_DOT` uses, as hex for RN. */
export const ENTITY_COLOR: Record<string, string> = {
  slate: "#64748b",
  blue: "#2563eb",
  green: "#16a34a",
  amber: "#d97706",
  rose: "#e11d48",
  violet: "#7c3aed",
};

const PROJECT_COLS =
  "id, name, description, color, icon, status, start_date, target_date, lead_user_id, created_at";

export function useProjects(propertyId: string | undefined) {
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const [projRes, taskRes] = await Promise.all([
      supabase
        .from("projects")
        .select(PROJECT_COLS)
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("tasks")
        .select("project_id, status")
        .eq("property_id", propertyId)
        .not("project_id", "is", null),
    ]);
    if (projRes.error) {
      setError(projRes.error.message);
      return;
    }
    const byId = new Map<string, ProjectSummary>();
    for (const p of (projRes.data ?? []) as ProjectRow[]) {
      byId.set(p.id, {
        ...p,
        total: 0,
        done: 0,
        counts: { todo: 0, in_progress: 0, blocked: 0, done: 0 },
      });
    }
    for (const t of (taskRes.data ?? []) as { project_id: string; status: TaskStatus }[]) {
      const p = byId.get(t.project_id);
      if (!p) continue;
      p.total += 1;
      p.counts[t.status] += 1;
      if (t.status === "done") p.done += 1;
    }
    setError(null);
    setRows([...byId.values()]);
  }, [propertyId]);

  useEffect(() => {
    // Kick the fetch off a microtask so the effect body itself sets no state
    // (react-hooks/set-state-in-effect); the subscription below reloads.
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!propertyId) return;
    const channel = supabase
      .channel(`projects-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `property_id=eq.${propertyId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, propertyId]);

  return { rows, error, reload: load };
}

export function useProject(projectId: string | undefined) {
  const [project, setProject] = useState<ProjectRow | null | undefined>(undefined);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const [projRes, taskRes, msRes] = await Promise.all([
      supabase.from("projects").select(PROJECT_COLS).eq("id", projectId).maybeSingle(),
      supabase
        .from("tasks")
        .select("id, title, status, priority, assignee_id, due_at, position")
        .eq("project_id", projectId)
        .order("position", { ascending: true }),
      supabase
        .from("project_milestones")
        .select("id, project_id, name, due_date, completed_at, position")
        .eq("project_id", projectId)
        .order("due_date", { ascending: true })
        .order("position", { ascending: true }),
    ]);
    if (projRes.error) {
      setError(projRes.error.message);
      return;
    }
    setError(null);
    setProject((projRes.data as ProjectRow | null) ?? null);
    setTasks((taskRes.data ?? []) as ProjectTask[]);
    setMilestones((msRes.data ?? []) as Milestone[]);
  }, [projectId]);

  useEffect(() => {
    // Kick the fetch off a microtask so the effect body itself sets no state
    // (react-hooks/set-state-in-effect); the subscription below reloads.
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`project-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_milestones", filter: `project_id=eq.${projectId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, projectId]);

  /** Flip reached / not reached. Optimistic; the Realtime echo reconciles. */
  const toggleMilestone = useCallback(async (m: Milestone) => {
    const next = m.completed_at ? null : new Date().toISOString();
    setMilestones((prev) => prev.map((x) => (x.id === m.id ? { ...x, completed_at: next } : x)));
    const { error: err } = await supabase
      .from("project_milestones")
      .update({ completed_at: next })
      .eq("id", m.id);
    if (err) {
      setMilestones((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      return err.message;
    }
    return null;
  }, []);

  const addMilestone = useCallback(
    async (propertyId: string, name: string, dueDate: string) => {
      if (!projectId) return "No project";
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const last = milestones[milestones.length - 1];
      const { error: err } = await supabase.from("project_milestones").insert({
        property_id: propertyId,
        project_id: projectId,
        name,
        due_date: dueDate,
        position: (last?.position ?? 0) + 1024,
        created_by: user?.id ?? null,
      });
      if (err) return err.message;
      await load();
      return null;
    },
    [projectId, milestones, load],
  );

  return { project, tasks, milestones, error, reload: load, toggleMilestone, addMilestone };
}

/** `YYYY-MM-DD` → "Oct 12" */
export function formatDateOnly(dateOnly: string | null): string | null {
  if (!dateOnly) return null;
  const [y, m, d] = dateOnly.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whole days from today to a `YYYY-MM-DD` (negative = past). */
export function daysUntil(dateOnly: string): number {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const target = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
