"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import { setTaskFieldValueFor } from "@/lib/tasks/field-write";

// Server actions for task custom fields (migration 0080). All writes go
// through the user's RLS client — custom fields are ordinary member data,
// same policies as tasks. The task.field_changed workflow event is emitted
// by the Postgres trigger, not here.

const FieldTypes = [
  "text",
  "long_text",
  "number",
  "currency",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
  "people",
  "files",
  "relation",
  "progress",
] as const;

/** Per-type settings (0116) — unknown keys are dropped. */
const ConfigZ = z
  .object({
    code: z.string().regex(/^[A-Z]{3}$/).optional(),
    precision: z.number().int().min(0).max(4).optional(),
    multiple: z.boolean().optional(),
    target_list_id: z.string().uuid().nullable().optional(),
  })
  .strip();

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
  config: ConfigZ.default({}),
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
      config: parsed.data.config,
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
  config: ConfigZ.optional(),
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
  if (parsed.data.config !== undefined) patch.config = parsed.data.config;
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
  // null clears the value (deletes the row). Arrays carry option ids
  // (labels), member ids (people) or task ids (relation).
  value: z
    .union([
      z.string().max(5000),
      z.number(),
      z.boolean(),
      z.array(z.string().max(60)).max(500),
    ])
    .nullable(),
});

/**
 * The UI's write — validation, coercion, the property / team / list fences
 * and the upsert-or-clear all live in `setTaskFieldValueFor`, shared with
 * workflows, the AI tool and forms (0116).
 */
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

  const res = await setTaskFieldValueFor(supabase, user.id, {
    propertyId: parsed.data.propertyId,
    taskId: parsed.data.taskId,
    field: parsed.data.fieldId,
    value: parsed.data.value,
  });
  return "error" in res ? res : { ok: true };
}
