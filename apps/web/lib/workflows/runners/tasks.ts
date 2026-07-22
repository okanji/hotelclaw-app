import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { RunnerImpl } from "./types";

type CreateTaskConfig = {
  title: string;
  description?: string;
  assignee_id?: string;
  due_at?: string;
  labels?: string[];
  project_name?: string;
  space_id?: string;
  project_id?: string;
  priority?: "none" | "low" | "medium" | "high" | "urgent";
  parent_id?: string;
};

export const createTaskRunner: RunnerImpl<
  CreateTaskConfig,
  { task: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      task: {
        id: `dry-${ctx.stepId}`,
        property_id: ctx.propertyId,
        ...config,
      },
    };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      property_id: ctx.propertyId,
      title: config.title,
      description: config.description ?? null,
      assignee_id: config.assignee_id ?? null,
      due_at: config.due_at ?? null,
      labels: config.labels ?? [],
      project_name: config.project_name ?? null,
      space_id: config.space_id ?? null,
      project_id: config.project_id ?? null,
      priority: config.priority ?? "none",
      parent_id: config.parent_id ?? null,
      created_by: ctx.workflowOwnerId,
      status: "todo",
      source: "workflow",
      source_workflow_id: ctx.workflowId,
      source_workflow_run_id: ctx.runId,
    })
    .select("*")
    .single();
  if (error) throw new Error(`create_task failed: ${error.message}`);
  return { task: data as Record<string, unknown> };
};

type UpdateTaskConfig = {
  task_id: string;
  title?: string;
  description?: string;
  status?: "todo" | "in_progress" | "blocked" | "done";
  priority?: "none" | "low" | "medium" | "high" | "urgent";
  assignee_id?: string;
  due_at?: string;
  labels?: string[];
  space_id?: string;
  project_id?: string;
};

export const updateTaskRunner: RunnerImpl<
  UpdateTaskConfig,
  { task: Record<string, unknown> }
> = async ({ config, ctx }) => {
  const { task_id, ...patch } = config;
  if (ctx.dryRun) {
    return { task: { id: task_id, ...patch } };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", task_id)
    .eq("property_id", ctx.propertyId)
    .select("*")
    .single();
  if (error) throw new Error(`update_task failed: ${error.message}`);
  return { task: data as Record<string, unknown> };
};

type AssignTaskConfig = { task_id: string; assignee_id: string };

export const assignTaskRunner: RunnerImpl<
  AssignTaskConfig,
  { task: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return { task: { id: config.task_id, assignee_id: config.assignee_id } };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ assignee_id: config.assignee_id })
    .eq("id", config.task_id)
    .eq("property_id", ctx.propertyId)
    .select("*")
    .single();
  if (error) throw new Error(`assign_task failed: ${error.message}`);
  return { task: data as Record<string, unknown> };
};

type AddLabelConfig = { task_id: string; label: string };

export const addLabelRunner: RunnerImpl<
  AddLabelConfig,
  { task: Record<string, unknown> }
> = async ({ config, ctx }) => {
  const supabase = createServiceClient();
  const { data: current, error: readErr } = await supabase
    .from("tasks")
    .select("labels")
    .eq("id", config.task_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (readErr || !current) {
    throw new Error(`add_label: task not found (${readErr?.message ?? "missing"})`);
  }
  const existing = current.labels ?? [];
  if (existing.includes(config.label)) {
    return { task: { id: config.task_id, labels: existing } };
  }
  const next = [...existing, config.label];
  if (ctx.dryRun) return { task: { id: config.task_id, labels: next } };
  const { data, error } = await supabase
    .from("tasks")
    .update({ labels: next })
    .eq("id", config.task_id)
    .eq("property_id", ctx.propertyId)
    .select("*")
    .single();
  if (error) throw new Error(`add_label failed: ${error.message}`);
  return { task: data as Record<string, unknown> };
};

type QueryTasksConfig = {
  status?: "open" | "todo" | "in_progress" | "blocked" | "done";
  space_id?: string;
  due?: "any" | "overdue";
  stuck_days?: number;
  limit?: number;
};

/**
 * Read step: fetch tasks matching filters so scheduled workflows can build
 * real reports ("every morning, list blocked work"). Output carries the raw
 * rows plus a preformatted `summary` (one line per task with status /
 * assignee / due / days-since-touch) that ai.* and chat steps can template
 * directly via {{steps.<id>.output.summary}}.
 */
export const queryTasksRunner: RunnerImpl<
  QueryTasksConfig,
  { count: number; tasks: Record<string, unknown>[]; summary: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return { count: 0, tasks: [], summary: "(dry-run: no tasks queried)" };
  }
  const supabase = createServiceClient();
  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, assignee_id, due_at, updated_at, space_id")
    .eq("property_id", ctx.propertyId)
    .order("updated_at", { ascending: true })
    .limit(Math.min(config.limit ?? 25, 50));

  const status = config.status ?? "open";
  if (status === "open") query = query.neq("status", "done");
  else query = query.eq("status", status);
  if (config.space_id) query = query.eq("space_id", config.space_id);
  if (config.due === "overdue") {
    query = query.lt("due_at", new Date().toISOString()).neq("status", "done");
  }
  if (config.stuck_days) {
    const cutoff = new Date(
      Date.now() - config.stuck_days * 86_400_000,
    ).toISOString();
    query = query.lt("updated_at", cutoff);
  }

  const { data: tasks, error } = await query;
  if (error) throw new Error(`task query failed: ${error.message}`);

  const assigneeIds = [
    ...new Set(
      (tasks ?? [])
        .map((t) => t.assignee_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const nameById = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", assigneeIds);
    for (const p of profiles ?? []) {
      if (p.full_name) nameById.set(p.id, p.full_name);
    }
  }

  const now = Date.now();
  const lines = (tasks ?? []).map((t) => {
    const staleDays = Math.floor(
      (now - new Date(t.updated_at).getTime()) / 86_400_000,
    );
    const parts = [
      `- ${t.title} [${t.status}]`,
      t.assignee_id ? `@${nameById.get(t.assignee_id) ?? "someone"}` : "(unassigned)",
      t.due_at ? `due ${String(t.due_at).slice(0, 10)}` : null,
      staleDays > 0 ? `untouched ${staleDays}d` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  });

  return {
    count: (tasks ?? []).length,
    tasks: (tasks ?? []) as Record<string, unknown>[],
    summary: lines.length > 0 ? lines.join("\n") : "No matching tasks.",
  };
};
