"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CustomFieldOption, Database } from "@/lib/db/types";

// Server actions for task custom fields (migration 0080). All writes go
// through the user's RLS client — custom fields are ordinary member data,
// same policies as tasks. The task.field_changed workflow event is emitted
// by the Postgres trigger, not here.

const FieldTypes = ["text", "number", "select", "date", "checkbox"] as const;

const OptionZ = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
});

const CreateFieldSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(1).max(60),
  type: z.enum(FieldTypes),
  options: z.array(OptionZ).max(30).default([]),
  spaceId: z.string().uuid().nullable().optional(),
});

export async function createCustomField(
  input: z.input<typeof CreateFieldSchema>,
): Promise<{ id: string } | { error: string }> {
  const parsed = CreateFieldSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  if (parsed.data.type === "select" && parsed.data.options.length === 0) {
    return { error: "A dropdown needs at least one option" };
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
  options: z.array(OptionZ).max(30).optional(),
  archived: z.boolean().optional(),
});

export async function updateCustomField(
  input: z.input<typeof UpdateFieldSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = UpdateFieldSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
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
  // null clears the value (deletes the row)
  value: z.union([z.string().max(500), z.number(), z.boolean()]).nullable(),
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
      .select("id, type, options")
      .eq("id", parsed.data.fieldId)
      .eq("property_id", parsed.data.propertyId)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id")
      .eq("id", parsed.data.taskId)
      .eq("property_id", parsed.data.propertyId)
      .maybeSingle(),
  ]);
  if (!field || !task) return { error: "Not found" };

  if (parsed.data.value === null) {
    const { error } = await supabase
      .from("task_field_values")
      .delete()
      .eq("task_id", parsed.data.taskId)
      .eq("field_id", parsed.data.fieldId);
    if (error) return { error: error.message };
    return { ok: true };
  }

  // Type-check the value against the field definition.
  const v = parsed.data.value;
  const ok =
    (field.type === "text" && typeof v === "string") ||
    (field.type === "number" && typeof v === "number" && Number.isFinite(v)) ||
    (field.type === "checkbox" && typeof v === "boolean") ||
    (field.type === "date" &&
      typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v)) ||
    (field.type === "select" &&
      typeof v === "string" &&
      (field.options as CustomFieldOption[]).some((o) => o.id === v));
  if (!ok) return { error: "Value doesn't match the field type" };

  const { error } = await supabase.from("task_field_values").upsert(
    {
      task_id: parsed.data.taskId,
      field_id: parsed.data.fieldId,
      property_id: parsed.data.propertyId,
      value: v,
      updated_by: user.id,
    },
    { onConflict: "task_id,field_id" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}
