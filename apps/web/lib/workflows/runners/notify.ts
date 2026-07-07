import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { createNotification, createNotifications } from "@/lib/notifications/server";
import type { RunnerImpl } from "./types";

type NotifyUserConfig = {
  user_id: string;
  title: string;
  body?: string;
  notification_type?: string;
};

export const notifyUserRunner: RunnerImpl<
  NotifyUserConfig,
  { notification_id: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return { notification_id: `dry-${ctx.stepId}` };
  }
  await createNotification({
    userId: config.user_id,
    propertyId: ctx.propertyId,
    type: "workflow",
    payload: {
      title: config.title,
      body: config.body ?? "",
      workflow_id: ctx.workflowId,
      run_id: ctx.runId,
      kind: config.notification_type ?? "workflow",
    },
  });
  // createNotification doesn't return the id; the dispatcher only needs to
  // know it succeeded. Use a synthetic placeholder for downstream chaining.
  return { notification_id: `sent-${ctx.stepId}` };
};

type NotifyRoleConfig = {
  role: "owner" | "manager" | "staff";
  title: string;
  body?: string;
  notification_type?: string;
};

export const notifyRoleRunner: RunnerImpl<
  NotifyRoleConfig,
  { notified_user_ids: string[] }
> = async ({ config, ctx }) => {
  const supabase = createServiceClient();
  const { data: members, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("property_id", ctx.propertyId)
    .eq("role", config.role);
  if (error) throw new Error(`notify_role failed: ${error.message}`);
  const userIds = (members ?? []).map((m) => m.user_id);
  if (ctx.dryRun || userIds.length === 0) {
    return { notified_user_ids: userIds };
  }
  await createNotifications(
    userIds.map((uid) => ({
      userId: uid,
      propertyId: ctx.propertyId,
      type: "workflow",
      payload: {
        title: config.title,
        body: config.body ?? "",
        workflow_id: ctx.workflowId,
        run_id: ctx.runId,
        kind: config.notification_type ?? "workflow",
      },
    })),
  );
  return { notified_user_ids: userIds };
};
