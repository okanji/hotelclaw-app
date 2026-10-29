import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CustomFieldConfig,
  CustomFieldOption,
  CustomFieldType,
  Database,
} from "@/lib/db/types";
import { formatTaskKey } from "@/lib/tasks/task-key";
import {
  coerceFieldValue,
  coerceNeeds,
  type CoerceCtx,
  type StoredFieldValue,
} from "@/lib/tasks/field-coerce";

type Db = SupabaseClient<Database>;

export type FieldWriteResult =
  | { ok: true; fieldId: string; fieldName: string; value: StoredFieldValue | null }
  | { error: string };

type FieldRow = {
  id: string;
  name: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  config: CustomFieldConfig | null;
  space_id: string | null;
  list_id: string | null;
};

/**
 * Set ONE custom-field value on a task — the single write path behind the
 * task sidebar / list cells (`setTaskFieldValue`), workflow
 * `action.task.set_field`, the AI `set_task_field` tool and forms → fields.
 *
 * `field` is an id or a name (case-insensitive). `value` is whatever the
 * caller has — a typed value from the UI or free text from a workflow / the
 * model — and goes through `coerceFieldValue`. Fences: the field and task
 * must be in `propertyId`, a team-scoped field needs a task in that team, a
 * list-scoped field a task in that list. Works with an RLS client (members)
 * or the service client (automation) — the fences don't rely on RLS.
 */
export async function setTaskFieldValueFor(
  db: Db,
  actorId: string | null,
  args: { propertyId: string; taskId: string; field: string; value: unknown },
): Promise<FieldWriteResult> {
  const needle = args.field.trim();
  const { data: fields, error: fieldsErr } = await db
    .from("custom_fields")
    .select("id, name, type, options, config, space_id, list_id")
    .eq("property_id", args.propertyId)
    .is("archived_at", null);
  if (fieldsErr) return { error: fieldsErr.message };
  const all = (fields ?? []) as FieldRow[];
  const field =
    all.find((f) => f.id === needle) ??
    all.find((f) => f.name.toLowerCase() === needle.toLowerCase());
  if (!field) {
    return {
      error: `No custom field named "${args.field}"${all.length ? ` (${all.map((f) => f.name).join(", ")})` : ""}`,
    };
  }

  const { data: task } = await db
    .from("tasks")
    .select("id, space_id, list_id")
    .eq("id", args.taskId)
    .eq("property_id", args.propertyId)
    .maybeSingle();
  if (!task) return { error: "Task not found in this property" };
  if (field.space_id && field.space_id !== task.space_id) {
    return { error: `${field.name} belongs to a different team` };
  }
  if (field.list_id && field.list_id !== task.list_id) {
    return { error: `${field.name} belongs to a different list` };
  }

  const needs = coerceNeeds(field.type);
  const ctx: CoerceCtx = {};
  if (needs.members) {
    const { data: ms } = await db
      .from("memberships")
      .select("user_id")
      .eq("property_id", args.propertyId);
    const ids = (ms ?? []).map((m) => m.user_id);
    const { data: profiles } = ids.length
      ? await db.from("profiles").select("id, full_name").in("id", ids)
      : { data: [] };
    ctx.members = (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name }));
  }
  if (needs.tasks) {
    const [{ data: tasks }, { data: prop }] = await Promise.all([
      db
        .from("tasks")
        .select("id, title, number, list_id")
        .eq("property_id", args.propertyId)
        .is("archived_at", null)
        .limit(5000),
      db.from("properties").select("task_prefix").eq("id", args.propertyId).maybeSingle(),
    ]);
    ctx.tasks = (tasks ?? [])
      .filter((t) => t.id !== args.taskId)
      .map((t) => ({
        id: t.id,
        title: t.title,
        key: formatTaskKey(prop?.task_prefix ?? null, t.number),
        list_id: t.list_id,
      }));
  }

  const coerced = coerceFieldValue(field, args.value, ctx);
  if (!coerced.ok) return { error: coerced.error };

  if (coerced.value === null) {
    const { error } = await db
      .from("task_field_values")
      .delete()
      .eq("task_id", args.taskId)
      .eq("field_id", field.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await db.from("task_field_values").upsert(
      {
        task_id: args.taskId,
        field_id: field.id,
        property_id: args.propertyId,
        value: coerced.value,
        updated_by: actorId,
      },
      { onConflict: "task_id,field_id" },
    );
    if (error) return { error: error.message };
  }
  return { ok: true, fieldId: field.id, fieldName: field.name, value: coerced.value };
}
