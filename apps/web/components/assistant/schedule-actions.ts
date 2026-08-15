"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { saveWorkflow } from "@/lib/workflows/save";
import {
  SCHEDULE_FREQUENCIES,
  buildProjectScheduleSpec,
  extractProjectScheduleConfig,
  specTargetsProject,
  type ProjectScheduleConfig,
} from "@/lib/assistant/schedule-automation";

/**
 * Server actions behind a project's Scheduled card.
 *
 * A schedule is a REAL workflow (schedule.cron → action.assistant.run), so it
 * stays visible and editable in the Workflows section — the same write-through
 * contract the Forms task-automation panel has. The card can only round-trip
 * the simple shape it emits; anything customized in the builder comes back
 * with `config: null` and the card goes read-only.
 *
 * Ownership: schedules run AS the workflow owner, and assistant rows are
 * personal, so a schedule may only be created against a project the caller
 * owns. That check is here and re-checked again in the runner, because the
 * workflow can outlive the project.
 */

type ActionError = { error: string };

const Uuid = z.string().uuid();

export type ProjectSchedule = {
  workflowId: string;
  name: string;
  enabled: boolean;
  /** Null when the workflow was customized in the builder. */
  config: ProjectScheduleConfig | null;
  lastRunAt: string | null;
};

const ConfigSchema = z.object({
  brief: z.string().trim().min(10).max(4000),
  title: z.string().trim().min(1).max(120),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekday: z.number().int().min(0).max(6),
  monthDay: z.number().int().min(1).max(28),
  timezone: z.string().trim().min(1).max(64),
  notify: z.boolean(),
});

/** The caller must own the project, not merely belong to the property. */
async function requireOwnedProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  projectId: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from("assistant_projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .maybeSingle();
  return data ?? null;
}

async function loadSchedules(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  projectId: string,
): Promise<ProjectSchedule[]> {
  const { data: workflows } = await supabase
    .from("workflows")
    .select("id, name, enabled, current_version_id, updated_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(500);

  const versionIds = (workflows ?? [])
    .map((w) => w.current_version_id)
    .filter((v): v is string => v !== null);
  if (versionIds.length === 0) return [];

  const { data: versions } = await supabase
    .from("workflow_versions")
    .select("id, spec")
    .in("id", versionIds);
  const specByVersion = new Map((versions ?? []).map((v) => [v.id, v.spec]));

  const matched = (workflows ?? []).filter((w) => {
    const spec = w.current_version_id ? specByVersion.get(w.current_version_id) : null;
    return spec ? specTargetsProject(spec, projectId) : false;
  });
  if (matched.length === 0) return [];

  // Last run = the newest conversation each schedule produced. Cheaper and
  // more honest than reading workflow_runs: what the user cares about is
  // whether a brief actually landed.
  const { data: runs } = await supabase
    .from("assistant_chats")
    .select("workflow_id, last_message_at")
    .in(
      "workflow_id",
      matched.map((w) => w.id),
    )
    .order("last_message_at", { ascending: false });
  const lastRun = new Map<string, string>();
  for (const run of runs ?? []) {
    if (run.workflow_id && !lastRun.has(run.workflow_id)) {
      lastRun.set(run.workflow_id, run.last_message_at);
    }
  }

  return matched.map((w) => ({
    workflowId: w.id,
    name: w.name,
    enabled: w.enabled,
    config: extractProjectScheduleConfig(
      w.current_version_id ? specByVersion.get(w.current_version_id) : null,
    ),
    lastRunAt: lastRun.get(w.id) ?? null,
  }));
}

export async function getProjectSchedules(input: {
  propertyId: string;
  projectId: string;
}): Promise<{ schedules: ProjectSchedule[] } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const projectId = Uuid.safeParse(input.projectId);
  if (!pid.success || !projectId.success) return { error: "Invalid input" };

  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };

  const supabase = await createClient();
  return { schedules: await loadSchedules(supabase, pid.data, projectId.data) };
}

export async function saveProjectSchedule(input: {
  propertyId: string;
  projectId: string;
  /** Omit to create a new schedule. */
  workflowId?: string;
  enabled: boolean;
  config: ProjectScheduleConfig;
}): Promise<{ schedules: ProjectSchedule[] } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const projectId = Uuid.safeParse(input.projectId);
  const config = ConfigSchema.safeParse(input.config);
  if (!pid.success || !projectId.success) return { error: "Invalid input" };
  if (!config.success) {
    return {
      error:
        config.error.issues[0]?.path[0] === "brief"
          ? "Describe what the assistant should do — a sentence or two."
          : "Check the schedule settings.",
    };
  }

  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // RLS already scopes assistant_projects to the caller, so a project that
  // isn't theirs simply doesn't resolve.
  const project = await requireOwnedProject(supabase, pid.data, projectId.data);
  if (!project) return { error: "Project not found" };

  let workflowId = input.workflowId ?? null;
  if (workflowId) {
    const existing = (await loadSchedules(supabase, pid.data, projectId.data)).find(
      (s) => s.workflowId === workflowId,
    );
    if (!existing) return { error: "Schedule not found" };
    if (existing.config === null) {
      return {
        error:
          "This schedule was customized in the Workflows builder — edit it there instead.",
      };
    }
  }

  const spec = buildProjectScheduleSpec({
    projectId: projectId.data,
    projectName: project.name,
    config: config.data,
  });

  if (!workflowId) {
    // Workflows have no member INSERT policy — same org-chart pattern the
    // Forms panel uses: role-gate through RLS above, write with the service
    // client, tenancy carried explicitly.
    const service = createServiceClient();
    const { data: created, error: createErr } = await service
      .from("workflows")
      .insert({
        property_id: pid.data,
        name: spec.name,
        description: `Runs the assistant in the "${project.name}" project on a schedule and files the result as a conversation.`,
        enabled: input.enabled,
        created_by: user.id,
        updated_by: user.id,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return { error: createErr?.message ?? "Could not create the schedule" };
    }
    workflowId = created.id;
  }

  try {
    await saveWorkflow({
      workflowId,
      propertyId: pid.data,
      userId: user.id,
      enabled: input.enabled,
      spec,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  return { schedules: await loadSchedules(supabase, pid.data, projectId.data) };
}

export async function setProjectScheduleEnabled(input: {
  propertyId: string;
  projectId: string;
  workflowId: string;
  enabled: boolean;
}): Promise<{ schedules: ProjectSchedule[] } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const projectId = Uuid.safeParse(input.projectId);
  const workflowId = Uuid.safeParse(input.workflowId);
  if (!pid.success || !projectId.success || !workflowId.success) {
    return { error: "Invalid input" };
  }

  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };

  const supabase = await createClient();
  const owned = (await loadSchedules(supabase, pid.data, projectId.data)).some(
    (s) => s.workflowId === workflowId.data,
  );
  if (!owned) return { error: "Schedule not found" };

  const service = createServiceClient();
  const { error } = await service
    .from("workflows")
    .update({ enabled: input.enabled })
    .eq("id", workflowId.data)
    .eq("property_id", pid.data);
  if (error) return { error: error.message };

  return { schedules: await loadSchedules(supabase, pid.data, projectId.data) };
}

/**
 * Archive the schedule. Deliberately NOT a delete: the conversations it has
 * already produced stay, and `assistant_chats.workflow_id` keeps pointing at a
 * row that still explains where they came from.
 */
export async function deleteProjectSchedule(input: {
  propertyId: string;
  projectId: string;
  workflowId: string;
}): Promise<{ schedules: ProjectSchedule[] } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const projectId = Uuid.safeParse(input.projectId);
  const workflowId = Uuid.safeParse(input.workflowId);
  if (!pid.success || !projectId.success || !workflowId.success) {
    return { error: "Invalid input" };
  }

  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };

  const supabase = await createClient();
  const owned = (await loadSchedules(supabase, pid.data, projectId.data)).some(
    (s) => s.workflowId === workflowId.data,
  );
  if (!owned) return { error: "Schedule not found" };

  const service = createServiceClient();
  const { error } = await service
    .from("workflows")
    .update({ enabled: false, archived_at: new Date().toISOString() })
    .eq("id", workflowId.data)
    .eq("property_id", pid.data);
  if (error) return { error: error.message };

  return { schedules: await loadSchedules(supabase, pid.data, projectId.data) };
}

/**
 * Turn off every schedule belonging to a project. Called when the project is
 * archived — otherwise its schedules keep firing into a project nobody can
 * open, and the runner's own guard would just log a skip forever.
 */
export async function disableSchedulesForProject(input: {
  propertyId: string;
  projectId: string;
}): Promise<{ disabled: number } | ActionError> {
  const pid = Uuid.safeParse(input.propertyId);
  const projectId = Uuid.safeParse(input.projectId);
  if (!pid.success || !projectId.success) return { error: "Invalid input" };

  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };

  const supabase = await createClient();
  const schedules = await loadSchedules(supabase, pid.data, projectId.data);
  const ids = schedules.filter((s) => s.enabled).map((s) => s.workflowId);
  if (ids.length === 0) return { disabled: 0 };

  const service = createServiceClient();
  const { error } = await service
    .from("workflows")
    .update({ enabled: false })
    .in("id", ids)
    .eq("property_id", pid.data);
  if (error) return { error: error.message };
  return { disabled: ids.length };
}
