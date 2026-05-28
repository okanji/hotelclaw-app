import "server-only";
import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { WorkflowSpec, classifyMode } from "@/lib/workflows/spec";
import { validateSpec } from "@/lib/workflows/validate";

// Shared "save a workflow" path used by both POST (create) and PATCH (edit).
// Validates the spec, classifies mode, writes a new workflow_versions row, and
// flips workflows.current_version_id to the new row.

export interface SaveWorkflowArgs {
  workflowId: string;
  propertyId: string;
  userId: string;
  name?: string;
  description?: string | null;
  enabled?: boolean;
  spec?: unknown; // when present, creates a new version
  notes?: string | null;
}

export interface SaveWorkflowResult {
  workflowId: string;
  currentVersionId: string | null;
  mode: "instant" | "durable";
}

export async function saveWorkflow(args: SaveWorkflowArgs): Promise<SaveWorkflowResult> {
  const supabase = createServiceClient();
  let currentVersionId: string | null = null;
  let mode: "instant" | "durable" = "instant";

  if (args.spec !== undefined) {
    const validation = validateSpec(args.spec);
    if (!validation.ok) {
      const detail = validation.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
      throw new Error(`invalid workflow spec — ${detail}`);
    }
    const parsed = WorkflowSpec.parse(args.spec);
    mode = classifyMode(parsed);

    const canonical = JSON.stringify(parsed);
    const specHash = createHash("sha256").update(canonical).digest("hex");

    // Determine the next version number for this workflow.
    const { data: lastVersion } = await supabase
      .from("workflow_versions")
      .select("version, spec_hash")
      .eq("workflow_id", args.workflowId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // No-op if the new spec hashes identically to the latest version.
    if (lastVersion?.spec_hash === specHash) {
      currentVersionId = null;
    } else {
      const nextVersion = (lastVersion?.version ?? 0) + 1;
      const { data: versionRow, error: versionErr } = await supabase
        .from("workflow_versions")
        .insert({
          workflow_id: args.workflowId,
          version: nextVersion,
          spec: parsed as unknown as Record<string, unknown>,
          spec_hash: specHash,
          notes: args.notes ?? null,
          created_by: args.userId,
        })
        .select("id")
        .single();
      if (versionErr || !versionRow) {
        throw new Error(`failed to write workflow_versions row: ${versionErr?.message}`);
      }
      currentVersionId = versionRow.id;
    }
  }

  const update: {
    updated_by?: string | null;
    name?: string;
    description?: string | null;
    enabled?: boolean;
    current_version_id?: string | null;
    mode?: "instant" | "durable";
  } = { updated_by: args.userId };
  if (args.name !== undefined) update.name = args.name;
  if (args.description !== undefined) update.description = args.description;
  if (args.enabled !== undefined) update.enabled = args.enabled;
  if (currentVersionId) {
    update.current_version_id = currentVersionId;
    update.mode = mode;
  }

  const { data: row, error: updateErr } = await supabase
    .from("workflows")
    .update(update)
    .eq("id", args.workflowId)
    .eq("property_id", args.propertyId)
    .select("id, current_version_id, mode, enabled")
    .single();
  if (updateErr || !row) {
    throw new Error(`failed to update workflow row: ${updateErr?.message}`);
  }

  // Reconcile pg_cron schedules. If the workflow's current spec has a
  // `schedule.cron` trigger AND the workflow is enabled, schedule (or
  // re-schedule) the cron job. Otherwise unschedule. The RPC functions
  // (workflows_schedule_cron / workflows_unschedule_cron, migration 0028)
  // own all pg_cron interaction so this code stays driver-agnostic.
  await reconcileCronSchedule(supabase, args.workflowId, row.enabled);

  return {
    workflowId: row.id,
    currentVersionId: row.current_version_id,
    mode: row.mode,
  };
}

async function reconcileCronSchedule(
  supabase: ReturnType<typeof createServiceClient>,
  workflowId: string,
  enabled: boolean,
): Promise<void> {
  // Re-read the current spec to find the trigger. We can't pass it in
  // because PATCH calls that don't include a new spec still need to
  // toggle scheduling on enable/disable.
  const { data: workflow } = await supabase
    .from("workflows")
    .select("current_version_id")
    .eq("id", workflowId)
    .maybeSingle();
  if (!workflow?.current_version_id) {
    await supabase.rpc("workflows_unschedule_cron", { p_workflow_id: workflowId });
    return;
  }
  const { data: version } = await supabase
    .from("workflow_versions")
    .select("spec")
    .eq("id", workflow.current_version_id)
    .maybeSingle();
  const spec = version?.spec as { trigger?: { event_type?: string; schedule?: { cron?: string; timezone?: string } } } | undefined;
  const trigger = spec?.trigger;

  const isCronTrigger = trigger?.event_type === "schedule.cron";
  if (!enabled || !isCronTrigger || !trigger?.schedule?.cron) {
    await supabase.rpc("workflows_unschedule_cron", { p_workflow_id: workflowId });
    return;
  }
  await supabase.rpc("workflows_schedule_cron", {
    p_workflow_id: workflowId,
    p_cron: trigger.schedule.cron,
    p_timezone: trigger.schedule.timezone ?? "UTC",
  });
}
