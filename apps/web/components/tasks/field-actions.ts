"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CustomFieldOption, Database } from "@/lib/db/types";

// Server actions for task custom fields (migration 0080). All writes go
// through the user's RLS client — custom fields are ordinary member data,
// same policies as tasks. The task.field_changed workflow event is emitted
// by the Postgres trigger, not here.

const FieldTypes = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
] as const;

/** Field types whose value is picked from `options`. */
const CHOICE_TYPES = ["select", "multi_select"] as const;
function isChoiceType(t: (typeof FieldTypes)[number]): boolean {
  return (CHOICE_TYPES as readonly string[]).includes(t);
}

const ColorZ = z.enum(["slate", "blue", "green", "amber", "rose", "violet"]);

const OptionZ = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  color: ColorZ.optional(),
});

const CreateFieldSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(1).max(60),
  type: z.enum(FieldTypes),
  // ClickUp caps dropdown/label fields at 500 options; same ceiling here.
  options: z.array(OptionZ).max(500).default([]),
  spaceId: z.string().uuid().nullable().optional(),
});

export async function createCustomField(
  input: z.input<typeof CreateFieldSchema>,
): Promise<{ id: string } | { error: string }> {
  const parsed = CreateFieldSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  if (isChoiceType(parsed.data.type) && parsed.data.options.length === 0) {
    return {
      error:
        parsed.data.type === "multi_select"
          ? "A label field needs at least one option"
          : "A dropdown needs at least one option",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // One field per name per scope keeps the manager sane (the ClickUp
  // duplicate-cost-fields problem). Case-insensitive.
  const { data: existing } = await supabase
    .from("custom_fields")
    .select("id, name, space_id")
    .eq("property_id", parsed.data.propertyId)
    .is("archived_at", null);
  const clash = (existing ?? []).some(
    (f) =>
      f.name.toLowerCase() === parsed.data.name.trim().toLowerCase() &&
      (f.space_id ?? null) === (parsed.data.spaceId ?? null),
  );
  if (clash) return { error: `A field named "${parsed.data.name}" already exists` };

  const { data, error } = await supabase
    .from("custom_fields")
    .insert({
      property_id: parsed.data.propertyId,
      name: parsed.data.name.trim(),
      type: parsed.data.type,
      options: parsed.data.options,
      space_id: parsed.data.spaceId ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };
  return { id: data.id };
}

const UpdateFieldSchema = z.object({
  fieldId: z.string().uuid(),
  name: z.string().min(1).max(60).optional(),
  options: z.array(OptionZ).max(500).optional(),
  archived: z.boolean().optional(),
});

export async function updateCustomField(
  input: z.input<typeof UpdateFieldSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = UpdateFieldSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();

  // Rename gets the same duplicate check as create — the field NAME is also
  // the workflow join key (`trigger.field_name`, `action.task.set_field`), so
  // two same-named fields in one scope make automations ambiguous.
  if (parsed.data.name !== undefined) {
    const { data: current } = await supabase
      .from("custom_fields")
      .select("id, property_id, space_id")
      .eq("id", parsed.data.fieldId)
      .maybeSingle();
    if (!current) return { error: "Field not found" };
    const { data: existing } = await supabase
      .from("custom_fields")
      .select("id, name, space_id")
      .eq("property_id", current.property_id)
      .is("archived_at", null);
    const clash = (existing ?? []).some(
      (f) =>
        f.id !== parsed.data.fieldId &&
        f.name.toLowerCase() === parsed.data.name!.trim().toLowerCase() &&
        (f.space_id ?? null) === (current.space_id ?? null),
    );
    if (clash) {
      return { error: `A field named "${parsed.data.name}" already exists` };
    }
  }

  const patch: Database["public"]["Tables"]["custom_fields"]["Update"] = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.options !== undefined) patch.options = parsed.data.options;
  if (parsed.data.archived !== undefined) {
    patch.archived_at = parsed.data.archived ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { data, error } = await supabase
    .from("custom_fields")
    .update(patch)
    .eq("id", parsed.data.fieldId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Field not found" };
  return { ok: true };
}

const SetValueSchema = z.object({
  propertyId: z.string().uuid(),
  taskId: z.string().uuid(),
  fieldId: z.string().uuid(),
  // null clears the value (deletes the row). An array is a multi_select
  // (label) value — the option ids that are ticked.
  value: z
    .union([
      z.string().max(500),
      z.number(),
      z.boolean(),
      z.array(z.string().max(60)).max(500),
    ])
    .nullable(),
});

export async function setTaskFieldValue(
  input: z.input<typeof SetValueSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = SetValueSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Tenancy: the field and the task must both belong to the claimed property
  // (RLS guarantees membership; this guards cross-property id mixing).
  const [{ data: field }, { data: task }] = await Promise.all([
    supabase
      .from("custom_fields")
      .select("id, type, options, space_id")
      .eq("id", parsed.data.fieldId)
      .eq("property_id", parsed.data.propertyId)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id, space_id")
      .eq("id", parsed.data.taskId)
      .eq("property_id", parsed.data.propertyId)
      .maybeSingle(),
  ]);
  if (!field || !task) return { error: "Not found" };

  // Scope: a team-scoped field only applies to that team's tasks. The task
  // sidebar already filters by scope; this closes the list-cell / bulk-edit
  // / API paths that previously accepted any field on any task.
  if (field.space_id && field.space_id !== task.space_id) {
    return { error: "This field is scoped to a different team" };
  }

  // An emptied label field is a cleared field — drop the row rather than
  // storing `[]`, so "Empty" filters and the trigger's from/to stay honest.
  const incoming =
    Array.isArray(parsed.data.value) && parsed.data.value.length === 0
      ? null
      : parsed.data.value;

  if (incoming === null) {
    const { error } = await supabase
      .from("task_field_values")
      .delete()
      .eq("task_id", parsed.data.taskId)
      .eq("field_id", parsed.data.fieldId);
    if (error) return { error: error.message };
    return { ok: true };
  }

  // Type-check the value against the field definition.
  const options = field.options as CustomFieldOption[];
  const v = incoming;
  const ok =
    (field.type === "text" && typeof v === "string") ||
    (field.type === "number" && typeof v === "number" && Number.isFinite(v)) ||
    (field.type === "checkbox" && typeof v === "boolean") ||
    (field.type === "date" &&
      typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v)) ||
    (field.type === "select" &&
      typeof v === "string" &&
      options.some((o) => o.id === v)) ||
    // Every ticked id must still exist on the definition — an option deleted
    // from the field can't be re-applied to a task.
    (field.type === "multi_select" &&
      Array.isArray(v) &&
      v.every((id) => options.some((o) => o.id === id)));
  if (!ok) return { error: "Value doesn't match the field type" };

  // Store label ids in definition order and de-duplicated, so the stored
  // array is canonical — the trigger's `is not distinct from` no-op check
  // compares arrays element-wise, and a reordered array is not a change.
  const stored = Array.isArray(v)
    ? options.filter((o) => v.includes(o.id)).map((o) => o.id)
    : v;

  const { error } = await supabase.from("task_field_values").upsert(
    {
      task_id: parsed.data.taskId,
      field_id: parsed.data.fieldId,
      property_id: parsed.data.propertyId,
      value: stored,
      updated_by: user.id,
    },
    { onConflict: "task_id,field_id" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}
