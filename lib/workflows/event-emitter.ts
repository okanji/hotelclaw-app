import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { dispatchEvent } from "@/lib/workflows/dispatcher";
import type { TriggerEventType } from "@/lib/workflows/spec";

// Webhook handlers (Stream / Liveblocks / Calendar) and any code path that
// observes a domain event calls emitWorkflowEvent() to drop a row into
// workflow_events. The dispatcher picks it up via Vercel Cron + (race-ahead)
// inline `after()` invocation.
//
// Postgres triggers on tasks/entities already emit directly via SQL — this
// module is for code paths that don't pass through the DB triggers.

export interface EmitWorkflowEventArgs {
  propertyId: string;
  source:
    | "stream.message"
    | "stream.call"
    | "liveblocks"
    | "calendar.google"
    | "calendar.microsoft"
    | "cron"
    | "manual";
  eventType: TriggerEventType;
  entityId?: string | null;
  entityKind?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Insert a new workflow_events row. Fire-and-forget — callers typically wrap
 * this in `after()` from `next/server` so it doesn't block the webhook
 * response. Returns the event id, or null on failure (so callers can decide
 * whether to log).
 */
export async function emitWorkflowEvent(
  args: EmitWorkflowEventArgs,
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("workflow_events")
    .insert({
      property_id: args.propertyId,
      source: args.source,
      event_type: args.eventType,
      entity_id: args.entityId ?? null,
      entity_kind: args.entityKind ?? null,
      payload: args.payload,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[workflows:event-emitter] insert failed", {
      eventType: args.eventType,
      source: args.source,
      error: error.message,
    });
    return null;
  }

  // Race the cron: dispatch in-process so chat/comment events fire sub-second.
  // The drain cron picks up anything we miss. Idempotency via the
  // (workflow_id, trigger_event_id) unique constraint on workflow_runs.
  try {
    await dispatchEvent(data.id);
  } catch (err) {
    console.error("[workflows:event-emitter] inline dispatch failed", err);
  }

  return data.id;
}
