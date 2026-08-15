import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { resumeHook } from "workflow/api";
import { WorkflowSpec, classifyMode } from "@/lib/workflows/spec";
import { hydrateTriggerPayload } from "@/lib/workflows/hydrate-payload";
import { evaluatePredicate } from "@/lib/workflows/predicate";
import { runWorkflowInstant } from "@/lib/workflows/instant-runtime";
import { runWorkflowDurable } from "@/lib/workflows/durable-runtime";

// Dispatcher: given an event id, find matching enabled workflows, evaluate
// trigger filters, and kick off a run for each survivor.
//
// Mode handling: instant mode runs in-process via runWorkflowInstant().
// Durable mode is logged as a stub for now — the Vercel Workflow SDK
// integration lands in week 3 and will swap out the stub for `start(...)`.
//
// Observability: every event records matched_workflow_ids + per-workflow
// filtered_reason ('disabled' | 'predicate_false' | 'rate_limited' |
// 'duplicate') so the run inspector can answer "why didn't my workflow run?".

export interface DispatchResult {
  eventId: string;
  matched: number;
  fired: number;
  filtered: number;
  skipped_reasons: Record<string, string>;
}

/**
 * Run a workflow's CURRENT version immediately with a supplied trigger payload,
 * independent of its trigger type. Used by the run inspector's "Re-run" (replay
 * the original run's input) and by test/dry-run. Unlike dispatchEvent, this
 * bypasses the trigger-type match and event flow — it just executes the spec.
 * `triggerEventId` is null so it never collides with the per-event idempotency
 * key (Postgres treats NULLs as distinct), letting a workflow be replayed many
 * times.
 */
export async function runWorkflowNow(opts: {
  workflowId: string;
  propertyId: string;
  triggerPayload: Record<string, unknown>;
  triggeredByUserId?: string | null;
  dryRun?: boolean;
}): Promise<{ runId: string; status: string }> {
  const supabase = createServiceClient();
  const { data: w } = await supabase
    .from("workflows")
    .select("id, current_version_id, created_by, mode")
    .eq("id", opts.workflowId)
    .eq("property_id", opts.propertyId)
    .maybeSingle();
  if (!w || !w.current_version_id) {
    throw new Error("This workflow has no saved version to run yet.");
  }
  const { data: versionRow } = await supabase
    .from("workflow_versions")
    .select("id, spec")
    .eq("id", w.current_version_id)
    .maybeSingle();
  if (!versionRow) throw new Error("Couldn't load the workflow's current version.");

  const parsed = WorkflowSpec.safeParse(versionRow.spec);
  if (!parsed.success) throw new Error("The workflow's saved spec is invalid.");
  const spec = parsed.data;
  const mode = w.mode ?? classifyMode(spec);

  const runArgs = {
    spec,
    workflowId: w.id,
    workflowVersionId: versionRow.id,
    propertyId: opts.propertyId,
    workflowOwnerId: w.created_by ?? "",
    triggerEventId: null,
    triggerPayload: opts.triggerPayload,
    triggeredByUserId: opts.triggeredByUserId ?? null,
    dryRun: opts.dryRun ?? false,
  };

  const result =
    mode === "durable"
      ? await runWorkflowDurable(runArgs)
      : await runWorkflowInstant(runArgs);
  return { runId: result.runId, status: result.status };
}

export async function dispatchEvent(eventId: string): Promise<DispatchResult> {
  const supabase = createServiceClient();

  const { data: event, error: eventErr } = await supabase
    .from("workflow_events")
    .select(
      "id, property_id, source, event_type, entity_id, entity_kind, payload, dispatched_at",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventErr || !event) {
    return { eventId, matched: 0, fired: 0, filtered: 0, skipped_reasons: {} };
  }

  if (event.dispatched_at) {
    return { eventId, matched: 0, fired: 0, filtered: 0, skipped_reasons: { _: "already_dispatched" } };
  }

  // Look up workflows on this property that have a current version, then
  // fetch those versions in one batched query. Two-step (vs. nested select)
  // keeps the type narrowing simple and avoids Supabase FK-hint fragility.
  const { data: workflows, error: candErr } = await supabase
    .from("workflows")
    .select("id, name, enabled, current_version_id, mode, created_by")
    .eq("property_id", event.property_id)
    .is("archived_at", null)
    .not("current_version_id", "is", null);

  if (candErr || !workflows || workflows.length === 0) {
    await supabase
      .from("workflow_events")
      .update({ dispatched_at: new Date().toISOString() })
      .eq("id", event.id);
    return { eventId, matched: 0, fired: 0, filtered: 0, skipped_reasons: {} };
  }

  // Names beside the raw people ids, once for every workflow this event
  // reaches — so filters and templates both see `assignee_name`.
  const triggerPayload = await hydrateTriggerPayload(
    (event.payload ?? {}) as Record<string, unknown>,
  );

  const versionIds = workflows
    .map((w) => w.current_version_id)
    .filter((v): v is string => v !== null);
  const { data: versions } = await supabase
    .from("workflow_versions")
    .select("id, spec")
    .in("id", versionIds);
  const versionById = new Map(
    (versions ?? []).map((v) => [v.id, v as { id: string; spec: Record<string, unknown> }]),
  );

  const matched: string[] = [];
  const skippedReasons: Record<string, string> = {};
  let firedCount = 0;
  let filteredCount = 0;

  for (const w of workflows) {
    const versionRow = w.current_version_id ? versionById.get(w.current_version_id) : null;
    if (!versionRow) continue;

    const parsed = WorkflowSpec.safeParse(versionRow.spec);
    if (!parsed.success) continue;
    const spec = parsed.data;

    if (spec.trigger.event_type !== event.event_type) continue;

    matched.push(w.id);

    if (!w.enabled) {
      skippedReasons[w.id] = "disabled";
      continue;
    }

    // Trigger filter predicate (optional).
    const filterExpr = spec.trigger.filter?.expr;
    if (filterExpr !== undefined) {
      const passed = (() => {
        try {
          return evaluatePredicate(filterExpr, {
            trigger: triggerPayload,
            context: { property_id: event.property_id },
          });
        } catch {
          return false;
        }
      })();
      if (!passed) {
        skippedReasons[w.id] = "predicate_false";
        filteredCount++;
        continue;
      }
    }

    // Entity-trigger scoping: spec.trigger.entity_type filters to entities of
    // that type. The payload includes `type` for entity events.
    if (spec.trigger.entity_type) {
      const payloadType = (triggerPayload as { type?: string }).type;
      if (payloadType !== spec.trigger.entity_type) {
        skippedReasons[w.id] = "predicate_false";
        filteredCount++;
        continue;
      }
    }

    const mode = w.mode ?? classifyMode(spec);
    const commonArgs = {
      spec,
      workflowId: w.id,
      workflowVersionId: versionRow.id,
      propertyId: event.property_id,
      workflowOwnerId: w.created_by ?? "",
      triggerEventId: event.id,
      triggerPayload,
    };

    try {
      if (mode === "durable") {
        await runWorkflowDurable(commonArgs);
      } else {
        await runWorkflowInstant(commonArgs);
      }
      firedCount++;
    } catch (err) {
      console.error(
        `[workflows:dispatcher] runWorkflow${mode === "durable" ? "Durable" : "Instant"} failed for workflow ${w.id}:`,
        err,
      );
      skippedReasons[w.id] = "runtime_error";
    }
  }

  // Auto-resume any wait_for_event hooks correlated to this event.
  const resumed = await resumeMatchingWaits(event);

  await supabase
    .from("workflow_events")
    .update({
      dispatched_at: new Date().toISOString(),
      matched_workflow_ids: matched,
      filtered_reason: skippedReasons,
    })
    .eq("id", event.id);

  return {
    eventId: event.id,
    matched: matched.length,
    fired: firedCount + resumed,
    filtered: filteredCount,
    skipped_reasons: skippedReasons,
  };
}

/**
 * Look for workflow_waits whose event_type + correlate match this event;
 * call resumeHook(token, payload) for each. The workflow function itself
 * deletes the wait row when it wakes up (disposeWait step), so we don't
 * touch the row here — race-safe.
 */
async function resumeMatchingWaits(event: {
  property_id: string;
  event_type: string;
  payload: unknown;
}): Promise<number> {
  const supabase = createServiceClient();
  const { data: waits, error } = await supabase
    .from("workflow_waits")
    .select("token, correlate")
    .eq("property_id", event.property_id)
    .eq("event_type", event.event_type);
  if (error || !waits || waits.length === 0) return 0;

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  let resumed = 0;
  for (const wait of waits) {
    if (!correlateMatches(wait.correlate as Record<string, string>, payload)) continue;
    try {
      await resumeHook(wait.token, payload);
      resumed++;
    } catch (err) {
      console.error(
        `[workflows:dispatcher] resumeHook failed for token ${wait.token}:`,
        err,
      );
    }
  }
  return resumed;
}

function correlateMatches(
  correlate: Record<string, string> | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!correlate) return true;
  for (const [path, expected] of Object.entries(correlate)) {
    const actual = pathLookup(payload, path);
    if (String(actual ?? "") !== String(expected ?? "")) return false;
  }
  return true;
}

function pathLookup(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (const p of parts) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[p];
  }
  return cursor;
}

/**
 * Drain undispatched events. Called by Vercel Cron every 15s — the webhook
 * handlers race the cron with synchronous after() emits, so latency is sub-
 * second on chat/comment events. This is the safety net for any event that
 * misses the inline race (Postgres-trigger emits in particular).
 *
 * Uses for-update + skip-locked semantics by claiming each row up-front via
 * a dispatched_at stamp; concurrent drains will skip rows already claimed.
 */
export async function drainEvents(maxBatch = 100): Promise<{ drained: number }> {
  const supabase = createServiceClient();
  const { data: events, error } = await supabase
    .from("workflow_events")
    .select("id")
    .is("dispatched_at", null)
    .order("received_at", { ascending: true })
    .limit(maxBatch);
  if (error || !events) return { drained: 0 };

  let drained = 0;
  for (const e of events) {
    try {
      await dispatchEvent(e.id);
      drained++;
    } catch (err) {
      console.error(`[workflows:dispatcher] drain failed for event ${e.id}:`, err);
    }
  }
  return { drained };
}
