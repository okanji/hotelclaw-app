import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { saveWorkflow } from "@/lib/workflows/save";
import {
  buildBlockedTaskAlertSpec,
  buildBookingAutoConfirmSpec,
  buildChatbotEscalationSpec,
  buildMaintenanceAutomationSpec,
} from "./automation-specs";

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

/** Shared insert+save recipe for one seeded workflow. */
async function seedWorkflow(args: {
  propertyId: string;
  userId: string;
  name: string;
  description: string;
  enabled: boolean;
  spec: Record<string, unknown>;
}): Promise<void> {
  const service = createServiceClient();
  const { data: created, error } = await service
    .from("workflows")
    .insert({
      property_id: args.propertyId,
      name: args.name,
      description: args.description,
      enabled: args.enabled,
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
    enabled: args.enabled,
    spec: args.spec,
  });
}

/**
 * The template-library automations beyond the maintenance starter. Each is a
 * hardcoded spec (automation-specs.ts) wired to the rows this onboarding
 * just created. Additive automations (task creation, chat post) ship
 * ENABLED; the booking auto-confirm mutates booking state, so it ships
 * disabled with a description telling the owner what flipping it on does.
 * Per-item fail-soft: one bad seed never blocks the others.
 */
export async function seedExtraAutomations(args: {
  propertyId: string;
  userId: string;
  /** Front-office/reception space for escalation tasks, when one exists. */
  frontSpaceId: string | null;
  /** #general stream channel id, when it was created. */
  generalChannelId: string | null;
  /** Whether starter bookable services were seeded. */
  hasBookings: boolean;
  /** Only alert on blocked tasks when task tracking is a stated priority. */
  wantsBlockedAlerts: boolean;
}): Promise<string[]> {
  const failures: string[] = [];
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[seedExtraAutomations] ${label} failed`, e);
      failures.push(label);
    }
  };

  await attempt("chatbot escalation automation", () =>
    seedWorkflow({
      propertyId: args.propertyId,
      userId: args.userId,
      name: "Chatbot escalations become tasks",
      description:
        "When the guest chatbot hands a conversation to a human, a high-priority task is created so it never slips.",
      enabled: true,
      spec: buildChatbotEscalationSpec({ spaceId: args.frontSpaceId }),
    }),
  );

  if (args.hasBookings) {
    await attempt("booking auto-confirm automation", () =>
      seedWorkflow({
        propertyId: args.propertyId,
        userId: args.userId,
        name: "Auto-confirm small bookings",
        description:
          "Turn this on to auto-confirm pending bookings for parties of 4 or fewer — larger parties stay pending for a human.",
        enabled: false,
        spec: buildBookingAutoConfirmSpec(),
      }),
    );
  }

  if (args.wantsBlockedAlerts && args.generalChannelId) {
    const channelId = args.generalChannelId;
    await attempt("blocked-task alert automation", () =>
      seedWorkflow({
        propertyId: args.propertyId,
        userId: args.userId,
        name: "Blocked tasks get called out",
        description:
          "When a task moves to blocked, a message is posted in #general so someone can unblock it.",
        enabled: true,
        spec: buildBlockedTaskAlertSpec({ channelId }),
      }),
    );
  }

  return failures;
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
