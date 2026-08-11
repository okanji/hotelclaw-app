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

type RemoveLabelConfig = { task_id: string; label: string };

export const removeLabelRunner: RunnerImpl<
  RemoveLabelConfig,
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
    throw new Error(
      `remove_label: task not found (${readErr?.message ?? "missing"})`,
    );
  }
  const existing = current.labels ?? [];
  // Case-insensitive, because a label typed into a workflow rarely matches
  // the stored casing exactly.
  const next = existing.filter(
    (l) => l.toLowerCase() !== config.label.trim().toLowerCase(),
  );
  if (next.length === existing.length) {
    return { task: { id: config.task_id, labels: existing } };
  }
  if (ctx.dryRun) return { task: { id: config.task_id, labels: next } };
  const { data, error } = await supabase
    .from("tasks")
    .update({ labels: next })
    .eq("id", config.task_id)
    .eq("property_id", ctx.propertyId)
    .select("*")
    .single();
  if (error) throw new Error(`remove_label failed: ${error.message}`);
  return { task: data as Record<string, unknown> };
};

type SetTaskFieldConfig = { task_id: string; field: string; value?: string };

/**
 * Write a custom field on a task — the write half of the custom-field story
 * (the read half, `task.field_changed`, has existed since 0080).
 *
 * The value arrives as a template string, so it is coerced to the field's
 * type here: dropdown/label values match an option by id OR by label
 * (case-insensitively), label fields accept a comma-separated list, and
 * checkboxes accept yes/no/true/false/1/0. An unmatched option is an ERROR
 * rather than a silent no-op — a typo'd option in an automation that claims
 * to have run is the failure mode worth being loud about.
 *
 * The write goes to `task_field_values`, whose trigger emits
 * `task.field_changed`, so downstream workflows chain off this exactly as
 * they do off a human edit.
 */
export const setTaskFieldRunner: RunnerImpl<
  SetTaskFieldConfig,
  { field_id: string; field_name: string; value: unknown }
> = async ({ config, ctx }) => {
  const supabase = createServiceClient();

  const { data: fields, error: fieldsErr } = await supabase
    .from("custom_fields")
    .select("id, name, type, options")
    .eq("property_id", ctx.propertyId)
    .is("archived_at", null);
  if (fieldsErr) throw new Error(`set_field failed: ${fieldsErr.message}`);

  const needle = config.field.trim().toLowerCase();
  const field = (fields ?? []).find(
    (f) => f.id === config.field.trim() || f.name.toLowerCase() === needle,
  );
  if (!field) throw new Error(`set_field: no custom field named "${config.field}"`);

  const raw = (config.value ?? "").trim();
  const options = (field.options ?? []) as { id: string; label: string }[];

  function matchOption(token: string): string {
    const t = token.trim();
    const hit = options.find(
      (o) => o.id === t || o.label.toLowerCase() === t.toLowerCase(),
    );
    if (!hit) {
      throw new Error(
        `set_field: "${t}" is not an option on ${field!.name} (${options
          .map((o) => o.label)
          .join(", ")})`,
      );
    }
    return hit.id;
  }

  let value: string | number | boolean | string[] | null;
  if (raw === "") {
    value = null;
  } else if (field.type === "checkbox") {
    value = ["true", "yes", "1", "checked", "on"].includes(raw.toLowerCase());
  } else if (field.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`set_field: "${raw}" is not a number`);
    value = n;
  } else if (field.type === "select") {
    value = matchOption(raw);
  } else if (field.type === "multi_select") {
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(matchOption);
    value = ids.length > 0 ? ids : null;
  } else {
    // text / date — stored as-is.
    value = raw;
  }

  if (ctx.dryRun) {
    return { field_id: field.id, field_name: field.name, value };
  }

  // Tenancy: the task must belong to the running property. RLS is bypassed by
  // the service client, so this check is the fence.
  const { data: task } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", config.task_id)
    .eq("property_id", ctx.propertyId)
    .maybeSingle();
  if (!task) throw new Error("set_field: task not found in this property");

  if (value === null) {
    const { error } = await supabase
      .from("task_field_values")
      .delete()
      .eq("task_id", config.task_id)
      .eq("field_id", field.id);
    if (error) throw new Error(`set_field failed: ${error.message}`);
  } else {
    const { error } = await supabase.from("task_field_values").upsert(
      {
        task_id: config.task_id,
        field_id: field.id,
        property_id: ctx.propertyId,
        value,
      },
      { onConflict: "task_id,field_id" },
    );
    if (error) throw new Error(`set_field failed: ${error.message}`);
  }

  return { field_id: field.id, field_name: field.name, value };
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
