"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { saveWorkflow } from "@/lib/workflows/save";
import { parseFormSchema, inputFields } from "@/lib/forms/schema";
import {
  buildFormTaskAutomationSpec,
  deriveTaskMappings,
  extractFormTaskAutomationConfig,
  specTargetsForm,
  FORM_AUTOMATION_PRIORITIES,
  type FormTaskAutomationConfig,
} from "@/lib/forms/task-automation";

/**
 * Server actions behind the ClickUp-style "After submitting → create a task"
 * panel on a form's Settings tab. The panel manages a REAL workflow
 * (form.submitted trigger → action.task.create step), so the automation also
 * shows up — and stays editable — in the Workflows section. Membership gate
 * mirrors the workflows API route: any property member.
 */

type ActionError = { error: string };

const Uuid = z.string().uuid();

export type FormTaskAutomationState = {
  workflowId: string;
  name: string;
  enabled: boolean;
  /**
   * The panel can edit the workflow only while it keeps the simple shape the
   * builder emits (single create-task step). `config: null` means it was
   * customized in the Workflows builder — the panel goes read-only.
   */
  config: FormTaskAutomationConfig | null;
};

/** Which task properties the form's questions currently map (from the form
 *  schema, so the panel can show "Assignee comes from a question" chips). */
export type FormTaskAutomationMappings = ReturnType<typeof deriveTaskMappings>;

async function loadFormMappings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  formId: string,
): Promise<FormTaskAutomationMappings> {
  const { data } = await supabase
    .from("forms")
    .select("schema")
    .eq("id", formId)
    .eq("property_id", propertyId)
    .maybeSingle();
  return deriveTaskMappings(inputFields(parseFormSchema(data?.schema)));
}

/** Find the workflow reacting to this form's submissions, newest first. */
async function findFormAutomation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  formId: string,
): Promise<FormTaskAutomationState | null> {
  const { data: workflows } = await supabase
    .from("workflows")
    .select("id, name, enabled, current_version_id")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  const versionIds = (workflows ?? [])
    .map((w) => w.current_version_id)
    .filter((v): v is string => v !== null);
  if (versionIds.length === 0) return null;

  const { data: versions } = await supabase
    .from("workflow_versions")
    .select("id, spec")
    .in("id", versionIds);
  const specByVersion = new Map((versions ?? []).map((v) => [v.id, v.spec]));

  for (const w of workflows ?? []) {
    const spec = w.current_version_id
      ? specByVersion.get(w.current_version_id)
      : null;
    if (!spec || !specTargetsForm(spec, formId)) continue;
    return {
      workflowId: w.id,
      name: w.name,
      enabled: w.enabled,
      config: extractFormTaskAutomationConfig(spec),
    };
  }
  return null;
}

export async function getFormTaskAutomation(input: {
  propertyId: string;
  formId: string;
}): Promise<
  | { automation: FormTaskAutomationState | null; mappings: FormTaskAutomationMappings }
  | ActionError
> {
  const pid = Uuid.safeParse(input.propertyId);
  const fid = Uuid.safeParse(input.formId);
  if (!pid.success || !fid.success) return { error: "Invalid input" };

  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };

  const supabase = await createClient();
  const [automation, mappings] = await Promise.all([
    findFormAutomation(supabase, pid.data, fid.data),
    loadFormMappings(supabase, pid.data, fid.data),
  ]);
  return { automation, mappings };
}

const SetSchema = z.object({
  propertyId: Uuid,
  formId: Uuid,
  enabled: z.boolean(),
  config: z.object({
    spaceId: Uuid.nullable(),
    assigneeId: Uuid.nullable(),
    priority: z.enum(FORM_AUTOMATION_PRIORITIES),
    labels: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
    includeAnswers: z.boolean().default(true),
  }),
});

/**
 * Create, update, or toggle the form's task automation. Rebuilds the spec
 * from the form's CURRENT schema (field references are positional), so a
 * save also refreshes the task title/description templates after the form's
 * questions changed.
 */
export async function setFormTaskAutomation(input: {
  propertyId: string;
  formId: string;
  enabled: boolean;
  config: FormTaskAutomationConfig;
}): Promise<
  | { automation: FormTaskAutomationState; mappings: FormTaskAutomationMappings }
  | ActionError
> {
  const parsed = SetSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { propertyId, formId, enabled, config } = parsed.data;

  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return { error: "Not a member of this property" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: form, error: formErr } = await supabase
    .from("forms")
    .select("id, property_id, title, icon, schema")
    .eq("id", formId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (formErr) return { error: formErr.message };
  if (!form) return { error: "Form not found" };

  const existing = await findFormAutomation(supabase, propertyId, formId);
  if (existing && existing.config === null) {
    return {
      error:
        "This form's automation was customized in the Workflows builder — edit it there instead.",
    };
  }

  const formFields = inputFields(parseFormSchema(form.schema));
  const spec = buildFormTaskAutomationSpec({
    formId,
    formTitle: form.title,
    formIcon: form.icon,
    fieldLabels: formFields.map((f) => f.label),
    config,
    // Task-property-mapped questions wire {{trigger.task_properties.*}} refs
    // into the created task; re-derived from the CURRENT schema every save.
    mappings: deriveTaskMappings(formFields),
  });

  let workflowId = existing?.workflowId ?? null;
  if (!workflowId) {
    const service = createServiceClient();
    const { data: created, error: createErr } = await service
      .from("workflows")
      .insert({
        property_id: propertyId,
        name: spec.name,
        description: `Every "${form.title}" submission opens a task automatically.`,
        enabled,
        created_by: user.id,
        updated_by: user.id,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return { error: createErr?.message ?? "Failed to create the automation" };
    }
    workflowId = created.id;
  }

  try {
    await saveWorkflow({
      workflowId,
      propertyId,
      userId: user.id,
      enabled,
      spec,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  return {
    automation: {
      workflowId,
      // Keep whatever name the user gave the workflow; only a fresh one takes
      // the builder's default.
      name: existing?.name ?? spec.name,
      enabled,
      config,
    },
    mappings: deriveTaskMappings(formFields),
  };
}
