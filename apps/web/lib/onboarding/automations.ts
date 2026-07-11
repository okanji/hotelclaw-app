import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { saveWorkflow } from "@/lib/workflows/save";
import { buildMaintenanceAutomationSpec } from "./automation-specs";

/**
 * Onboarding-seeded automations + default insight alert rules — the last
 * "build everything" artifacts. Both are deliberately deterministic (no
 * model): the automation spec is a fixed two-node graph, and the alert rules
 * are a fixed starter set. Fail-soft callers (createWorkspace) wrap these in
 * warn() stages.
 */

/** Create + enable the canonical starter automation: a submission of the
 *  onboarding-generated maintenance form becomes a task (routed to the
 *  maintenance/engineering team when one exists). */
export async function seedStarterAutomation(args: {
  propertyId: string;
  userId: string;
  formId: string;
  formTitle: string;
  /** Maintenance/engineering space id, when the plan created one. */
  spaceId: string | null;
}): Promise<void> {
  const service = createServiceClient();
  const { data: created, error } = await service
    .from("workflows")
    .insert({
      property_id: args.propertyId,
      name: "Maintenance requests become tasks",
      description: `Every "${args.formTitle}" submission opens a task automatically.`,
      // Enabled out of the box — it only reacts to the form this same
      // onboarding created, and the review screen lists it.
      enabled: true,
      created_by: args.userId,
      updated_by: args.userId,
    })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`workflow insert failed: ${error?.message ?? "no row"}`);
  }

  await saveWorkflow({
    workflowId: created.id,
    propertyId: args.propertyId,
    userId: args.userId,
    enabled: true,
    spec: buildMaintenanceAutomationSpec({
      formId: args.formId,
      formTitle: args.formTitle,
      spaceId: args.spaceId,
    }),
  });
}

/** Starter alert rules for the owner (scope = whole property). The unique
 *  (user, property, scope, metric) constraint makes this idempotent. */
export async function seedDefaultAlertRules(args: {
  propertyId: string;
  userId: string;
}): Promise<void> {
  const service = createServiceClient();
  const rules = [
    { metric: "overdue_count", threshold: 5 },
    { metric: "blocked_count", threshold: 3 },
    { metric: "unassigned_urgent_count", threshold: 1 },
    { metric: "project_at_risk", threshold: null },
  ] as const;
  const { error } = await service.from("insight_alert_rules").upsert(
    rules.map((r) => ({
      user_id: args.userId,
      property_id: args.propertyId,
      scope: "property",
      metric: r.metric,
      threshold: r.threshold,
      enabled: true,
    })),
    { onConflict: "user_id,property_id,scope,metric", ignoreDuplicates: true },
  );
  if (error) throw new Error(`alert rules upsert failed: ${error.message}`);
}
