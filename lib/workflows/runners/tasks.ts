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
