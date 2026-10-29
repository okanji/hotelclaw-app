import { addChecklistItemsFor } from "@/lib/tasks/checklist-write";
import { setTaskFieldValueFor } from "@/lib/tasks/field-write";
import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { statusPatchForTask } from "@/lib/tasks/status-resolve";
import type { RunnerImpl } from "./types";
import type { Database } from "@/lib/db/types";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

type CreateTaskConfig = {
  title: string;
  description?: string;
  assignee_id?: string;
  due_at?: string;
  /** After template resolution an item can be an array (a ref that resolved
   *  to a list, e.g. {{trigger.task_properties.labels}}) or null/"" (an
   *  unanswered mapped field) — flattenLabels normalizes all of it. */
  labels?: unknown[];
  project_name?: string;
  space_id?: string;
  project_id?: string;
  priority?: string;
  parent_id?: string;
  /** 0116 — custom-field id/name → resolved value. */
  fields?: Record<string, unknown>;
};

type FormFile = { url?: string; path?: string; name?: string; size?: number; type?: string };

function isFormFileList(v: unknown): v is FormFile[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((f) => f && typeof f === "object" && typeof (f as FormFile).name === "string")
  );
}

/**
 * Write a create step's `fields` onto the new task. Never throws — a bad
 * value on one field must not lose the task; failures come back as
 * `field_errors` on the step output. A form FILE answer is copied from the
 * form-uploads bucket into task-attachments and registered against the
 * files field (the DB derives the field value from those rows).
 */
async function applyCreateFields(
  supabase: ReturnType<typeof createServiceClient>,
  args: { propertyId: string; taskId: string; actorId: string | null; fields: Record<string, unknown> },
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const [field, value] of Object.entries(args.fields)) {
    if (value === undefined || value === null || value === "") continue;
    try {
      if (isFormFileList(value)) {
        const { data: defs } = await supabase
          .from("custom_fields")
          .select("id, name, type")
          .eq("property_id", args.propertyId)
          .is("archived_at", null);
        const def = (defs ?? []).find(
          (d) => d.id === field || d.name.toLowerCase() === field.trim().toLowerCase(),
        );
        if (!def || def.type !== "files") {
          errors[field] = "Not a files field";
          continue;
        }
        for (const file of value) {
          const name = (file.name ?? "file").replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
          const dest = `${args.propertyId}/${args.taskId}/${crypto.randomUUID()}-${name}`;
          let copied = false;
          if (file.path) {
            const { error: copyErr } = await supabase.storage
              .from("form-uploads")
              .copy(file.path, dest, { destinationBucket: "task-attachments" });
            copied = !copyErr;
          }
          if (!copied && file.url) {
            // Fallback: fetch the public form upload and re-upload it.
            const res = await fetch(file.url).catch(() => null);
            if (res?.ok) {
              const blob = await res.blob();
              const { error: upErr } = await supabase.storage
                .from("task-attachments")
                .upload(dest, blob, { contentType: file.type || blob.type || "application/octet-stream" });
              copied = !upErr;
            }
          }
          if (!copied) {
            errors[field] = `Couldn't copy ${file.name ?? "a file"}`;
            continue;
          }
          const { error: insErr } = await supabase.from("task_attachments").insert({
            task_id: args.taskId,
            file_name: file.name ?? name,
            storage_path: dest,
            mime_type: file.type ?? null,
            byte_size: typeof file.size === "number" ? file.size : null,
            field_id: def.id,
            created_by: args.actorId,
          });
          if (insErr) errors[field] = insErr.message;
        }
        continue;
      }
      const res = await setTaskFieldValueFor(supabase, args.actorId, {
        propertyId: args.propertyId,
        taskId: args.taskId,
        field,
        value,
      });
      if ("error" in res) errors[field] = res.error;
    } catch (err) {
      errors[field] = err instanceof Error ? err.message : String(err);
    }
  }
  return errors;
}

const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

function normalizePriority(value: string | undefined): (typeof TASK_PRIORITIES)[number] {
  return (TASK_PRIORITIES as readonly string[]).includes(value ?? "")
    ? (value as (typeof TASK_PRIORITIES)[number])
    : "none";
}

function flattenLabels(labels: unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const item of labels ?? []) {
    for (const label of Array.isArray(item) ? item : [item]) {
      if (typeof label === "string" && label.trim()) out.push(label.trim());
    }
  }
  return [...new Set(out)];
}

export const createTaskRunner: RunnerImpl<
  CreateTaskConfig,
  { task: Record<string, unknown>; field_errors?: Record<string, string> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return {
      task: {
        id: `dry-${ctx.stepId}`,
        property_id: ctx.propertyId,
        ...config,
        labels: flattenLabels(config.labels),
        priority: normalizePriority(config.priority),
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
      assignee_id: config.assignee_id || null,
      due_at: config.due_at || null,
      labels: flattenLabels(config.labels),
      project_name: config.project_name ?? null,
      space_id: config.space_id ?? null,
      project_id: config.project_id ?? null,
      priority: normalizePriority(config.priority),
      parent_id: config.parent_id ?? null,
      created_by: ctx.workflowOwnerId,
      // No status: the 0114 resolver files it in the team's default list (or
      // General) at that list's open status.
      source: "workflow",
      source_workflow_id: ctx.workflowId,
      source_workflow_run_id: ctx.runId,
    })
    .select("*")
    .single();
  if (error) throw new Error(`create_task failed: ${error.message}`);
  if (config.fields && Object.keys(config.fields).length > 0) {
    const fieldErrors = await applyCreateFields(supabase, {
      propertyId: ctx.propertyId,
      taskId: data.id,
      actorId: ctx.workflowOwnerId ?? null,
      fields: config.fields,
    });
    if (Object.keys(fieldErrors).length > 0) {
      return { task: data as Record<string, unknown>, field_errors: fieldErrors };
    }
  }
  return { task: data as Record<string, unknown> };
};

type UpdateTaskConfig = {
  task_id: string;
  title?: string;
  description?: string;
  /** Status name / id of the task's list, or a legacy literal (0114). */
  status?: string;
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
  const { task_id, status, ...rest } = config;
  if (ctx.dryRun) {
    return { task: { id: task_id, ...rest, ...(status ? { status } : {}) } };
  }
  const supabase = createServiceClient();
  const patch: TaskUpdate = { ...rest };
  if (status) {
    const { patch: statusPatch, names } = await statusPatchForTask(supabase, task_id, status);
    if (!statusPatch) {
      throw new Error(
        `update_task failed: no status "${status}" in this task's list (valid: ${names.join(", ") || "none"})`,
      );
    }
    Object.assign(patch, statusPatch);
  }
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

type AssignTaskConfig = { task_id: string; assignee_id: string; mode?: "replace" | "add" };

export const assignTaskRunner: RunnerImpl<
  AssignTaskConfig,
  { task: Record<string, unknown> }
> = async ({ config, ctx }) => {
  const mode = config.mode ?? "replace";
  if (ctx.dryRun) {
    return { task: { id: config.task_id, assignee_id: config.assignee_id, mode } };
  }
  const supabase = createServiceClient();
  if (mode === "add") {
    // The service client skips RLS, so fence the person to the property
    // the way the member insert policy would.
    const { data: member } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("property_id", ctx.propertyId)
      .eq("user_id", config.assignee_id)
      .maybeSingle();
    if (!member) throw new Error("assign_task: that person is not a member of this property");
    const { data: owned } = await supabase
      .from("tasks")
      .select("id")
      .eq("id", config.task_id)
      .eq("property_id", ctx.propertyId)
      .maybeSingle();
    if (!owned) throw new Error("assign_task: task not found");
    const { data: existing } = await supabase
      .from("task_assignees")
      .select("position")
      .eq("task_id", config.task_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error: addErr } = await supabase.from("task_assignees").upsert(
      {
        task_id: config.task_id,
        user_id: config.assignee_id,
        property_id: ctx.propertyId,
        position: (existing?.position ?? -1) + 1,
      },
      { onConflict: "task_id,user_id", ignoreDuplicates: true },
    );
    if (addErr) throw new Error(`assign_task failed: ${addErr.message}`);
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", config.task_id)
      .eq("property_id", ctx.propertyId)
      .single();
    if (error) throw new Error(`assign_task failed: ${error.message}`);
    return { task: data as Record<string, unknown> };
  }
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

type AddChecklistConfig = { task_id: string; name: string; items: string };

/** 0117 — find-or-create a named checklist and append the items. */
export const addChecklistRunner: RunnerImpl<
  AddChecklistConfig,
  { checklist_id: string; created: boolean; added: number }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    const { parseChecklistText } = await import("@/lib/tasks/checklist-progress");
    const lines = parseChecklistText(config.items ?? "");
    return {
      checklist_id: `dry-${ctx.stepId}`,
      created: true,
      added: lines.reduce((n, l) => n + 1 + l.children.length, 0),
    };
  }
  const res = await addChecklistItemsFor(createServiceClient(), {
    propertyId: ctx.propertyId,
    taskId: config.task_id,
    name: config.name,
    items: config.items ?? "",
  });
  if ("error" in res) throw new Error(`add_checklist: ${res.error}`);
  return { checklist_id: res.checklistId, created: res.created, added: res.added };
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

  if (ctx.dryRun) {
    // Resolve + coerce without writing, so a test run still surfaces a bad
    // option name or an unparseable amount.
    const { data: fields } = await supabase
      .from("custom_fields")
      .select("id, name, type, options, config")
      .eq("property_id", ctx.propertyId)
      .is("archived_at", null);
    const needle = config.field.trim().toLowerCase();
    const field = (fields ?? []).find(
      (f) => f.id === config.field.trim() || f.name.toLowerCase() === needle,
    );
    if (!field) throw new Error(`set_field: no custom field named "${config.field}"`);
    const { coerceFieldValue } = await import("@/lib/tasks/field-coerce");
    const coerced = coerceFieldValue(field, config.value ?? "");
    // people / relation need DB lookups — report the raw text in a dry run.
    if (!coerced.ok && field.type !== "people" && field.type !== "relation") {
      throw new Error(`set_field: ${coerced.error}`);
    }
    return {
      field_id: field.id,
      field_name: field.name,
      value: coerced.ok ? coerced.value : config.value,
    };
  }

  // One write path (0116): coercion for every type, the property fence, and
  // the team / list scope check this runner used to skip.
  const res = await setTaskFieldValueFor(supabase, null, {
    propertyId: ctx.propertyId,
    taskId: config.task_id,
    field: config.field,
    value: config.value ?? "",
  });
  if ("error" in res) throw new Error(`set_field: ${res.error}`);
  return { field_id: res.fieldId, field_name: res.fieldName, value: res.value };
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

  // `status` values are categories (0114): the legacy projection column IS
  // the category rollup, so filtering on it covers every list's own names;
  // "open" / "done" key on completed_at, the finished stamp.
  const status = config.status ?? "open";
  if (status === "open") query = query.is("completed_at", null);
  else if (status === "done") query = query.not("completed_at", "is", null);
  else query = query.eq("status", status);
  if (config.space_id) query = query.eq("space_id", config.space_id);
  if (config.due === "overdue") {
    query = query.lt("due_at", new Date().toISOString()).is("completed_at", null);
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
