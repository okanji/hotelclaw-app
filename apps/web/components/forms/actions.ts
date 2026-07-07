"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";
import {
  FormFileValueZod,
  FormSchemaZod,
  parseFormSchema,
  validateAnswers,
  formatAnswer,
  inputFields,
  type FormAnswers,
  type FormAnswerValue,
} from "@/lib/forms/schema";
import { resolveLabels } from "@/lib/forms/resolve-options";
import type { FormResponseSource, FormStatus } from "@/lib/db/types";

type ActionError = { error: string };

/** Selected option ids from a sourced choice answer (string or string[]). */
function answerIds(value: FormAnswerValue | undefined): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

const Uuid = z.string().uuid();
const Title = z.string().trim().min(1).max(160);

export async function createForm(input: {
  propertyId: string;
  title: string;
  description?: string | null;
  schema?: unknown;
  spaceId?: string | null;
}): Promise<{ formId: string } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const title = Title.safeParse(input.title);
  if (!pid.success) return { error: "Invalid property" };
  if (!title.success) return { error: "Form title is required" };
  const schema = input.schema ? FormSchemaZod.safeParse(input.schema) : null;
  if (input.schema && !schema?.success) return { error: "Invalid form schema" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("forms")
    .insert({
      property_id: pid.data,
      title: title.data,
      description: input.description?.trim() || null,
      schema: schema?.success ? schema.data : undefined,
      space_id: input.spaceId ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to create form" };

  revalidatePath(`/p/${pid.data}/forms`);
  return { formId: data.id };
}

const UpdateSchema = z.object({
  formId: Uuid,
  patch: z.object({
    title: Title.optional(),
    description: z.string().max(2000).nullable().optional(),
    icon: z.string().max(16).nullable().optional(),
    schema: FormSchemaZod.optional(),
    status: z.enum(["draft", "published", "closed"]).optional(),
    allow_multiple: z.boolean().optional(),
    anonymous: z.boolean().optional(),
    space_id: Uuid.nullable().optional(),
    archived_at: z.string().nullable().optional(),
  }),
});

export async function updateForm(input: {
  formId: string;
  patch: {
    title?: string;
    description?: string | null;
    icon?: string | null;
    schema?: unknown;
    status?: FormStatus;
    allow_multiple?: boolean;
    anonymous?: boolean;
    space_id?: string | null;
    archived_at?: string | null;
  };
}): Promise<{ ok: true } | ActionError> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("forms")
    .update(parsed.data.patch)
    .eq("id", parsed.data.formId)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Form not found" };

  revalidatePath(`/p/${data.property_id}/forms`);
  return { ok: true };
}

export async function deleteForm(formId: string): Promise<{ ok: true } | ActionError> {
  const id = Uuid.safeParse(formId);
  if (!id.success) return { error: "Invalid form" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("forms")
    .delete()
    .eq("id", id.data)
    .select("property_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Form not found" };

  revalidatePath(`/p/${data.property_id}/forms`);
  return { ok: true };
}

const SubmitSchema = z.object({
  formId: Uuid,
  answers: z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z.array(FormFileValueZod),
      z.null(),
    ]),
  ),
  source: z.enum(["direct", "chat", "workflow", "onboarding"]).default("direct"),
});

/**
 * Submit a response. Validates answers against the form's current schema
 * server-side (the renderer validates the same way client-side), inserts the
 * response, and emits a `form.submitted` workflow event so automations can
 * react — e.g. "when the maintenance form is submitted, create a task".
 */
export async function submitFormResponse(input: {
  formId: string;
  answers: FormAnswers;
  source?: FormResponseSource;
}): Promise<{ responseId: string } | { error: string; fieldErrors?: Record<string, string> }> {
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: form, error: formErr } = await supabase
    .from("forms")
    .select("id, property_id, title, schema, status, allow_multiple, anonymous")
    .eq("id", parsed.data.formId)
    .maybeSingle();
  if (formErr) return { error: formErr.message };
  if (!form) return { error: "Form not found" };
  if (form.status !== "published") {
    return { error: form.status === "closed" ? "This form is closed" : "This form isn't published yet" };
  }

  const schema = parseFormSchema(form.schema);
  const validated = validateAnswers(schema, parsed.data.answers);
  if (!validated.ok) {
    return { error: "Some answers need attention", fieldErrors: validated.errors };
  }

  if (!form.allow_multiple && !form.anonymous) {
    const { data: prior } = await supabase
      .from("form_responses")
      .select("id")
      .eq("form_id", form.id)
      .eq("respondent_id", user.id)
      .limit(1)
      .maybeSingle();
    if (prior) return { error: "You've already responded to this form" };
  }

  const { data: response, error: insErr } = await supabase
    .from("form_responses")
    .insert({
      form_id: form.id,
      property_id: form.property_id,
      respondent_id: form.anonymous ? null : user.id,
      answers: validated.answers,
      source: parsed.data.source,
    })
    .select("id")
    .single();
  if (insErr || !response) return { error: insErr?.message ?? "Failed to submit" };

  // Data-connected choice fields store raw ids; resolve them to display
  // labels for the formatted payload. Fail-soft — on any resolver failure
  // the formatted value falls back to formatAnswer below.
  const labelsByField = new Map<string, Map<string, string>>();
  for (const f of inputFields(schema)) {
    if ((f.type !== "select" && f.type !== "multi_select") || !f.source) continue;
    const ids = answerIds(validated.answers[f.id]);
    if (ids.length === 0) continue;
    try {
      const labels = await resolveLabels(supabase, form.property_id, f.source, ids);
      if (labels.size > 0) labelsByField.set(f.id, labels);
    } catch {
      // formatted falls back to formatAnswer
    }
  }

  // Labeled field list so workflow templates can reference answers by label
  // ({{trigger.fields}}) without knowing the schema's generated field ids.
  const fields = inputFields(schema).map((f) => {
    const value = validated.answers[f.id];
    const labels = labelsByField.get(f.id);
    let formatted = formatAnswer(f, value);
    if (labels) {
      if (typeof value === "string") {
        formatted = labels.get(value) ?? formatted;
      } else if (Array.isArray(value)) {
        formatted = value
          .filter((v): v is string => typeof v === "string")
          .map((v) => labels.get(v) ?? v)
          .join(", ");
      }
    }
    return {
      id: f.id,
      label: f.label,
      type: f.type,
      value: value ?? null,
      formatted,
    };
  });

  after(async () => {
    await emitWorkflowEvent({
      propertyId: form.property_id,
      source: "form",
      eventType: "form.submitted",
      entityId: form.id,
      entityKind: "form",
      payload: {
        form_id: form.id,
        form_title: form.title,
        response_id: response.id,
        respondent_id: form.anonymous ? null : user.id,
        submission_source: parsed.data.source,
        answers: validated.answers,
        fields,
      },
    });
  });

  return { responseId: response.id };
}
