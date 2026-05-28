import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { WorkflowSpec, type StepNode } from "@/lib/workflows/spec";
import { getStep } from "@/lib/workflows/catalog";
import { getRunner } from "@/lib/workflows/runners";
import { resolveValue, type ResolutionScope } from "@/lib/workflows/resolve";
import { evaluatePredicate } from "@/lib/workflows/predicate";
import type { RunnerContext } from "@/lib/workflows/catalog/types";

// In-process graph walker. Used when classifyMode(spec) === "instant" — i.e.
// no delays, no waits, no loops, no parallel, ≤ 10 steps, no long AI calls.
// For everything else, durable-runtime.ts (Vercel Workflow SDK) takes over.
//
// Step execution lifecycle per step:
//   1. resolve config against the current scope
//   2. (control nodes) compute next step inline, write a synthesized step_run
//   3. (action/ai nodes) call the catalog runner; on error apply retry +
//      on_error policy; write a workflow_step_runs row either way
//   4. update scope with steps[id].output
//   5. pick next step id (step.next or via branches)
//   6. loop until next is undefined or terminal

// Hard safety bound — even though classifyMode() caps node count, we don't
// want runaway loops if branches misroute.
const MAX_STEPS_PER_RUN = 50;

export interface InstantRunArgs {
  spec: WorkflowSpec;
  workflowId: string;
  workflowVersionId: string;
  propertyId: string;
  workflowOwnerId: string;
  triggerEventId: string | null;
  /** Payload exposed as {{trigger.*}} — the new/old/etc. emitted by the event source. */
  triggerPayload: Record<string, unknown>;
  /** Manual / scheduled runs pass through the user id of the operator (null for cron). */
  triggeredByUserId?: string | null;
  dryRun?: boolean;
}

export interface InstantRunResult {
  runId: string;
  status: "succeeded" | "failed" | "filtered" | "cancelled";
  error?: string;
  /** Final scope snapshot — useful for tests + the run inspector preview. */
  scope: ResolutionScope;
}

export async function runWorkflowInstant(args: InstantRunArgs): Promise<InstantRunResult> {
  const supabase = createServiceClient();

  const { data: runRow, error: insertErr } = await supabase
    .from("workflow_runs")
    .insert({
      workflow_id: args.workflowId,
      workflow_version_id: args.workflowVersionId,
      property_id: args.propertyId,
      trigger_event_id: args.triggerEventId,
      trigger_kind: args.spec.trigger.event_type,
      status: "running",
      mode: "instant",
      triggered_by_user_id: args.triggeredByUserId ?? null,
      input: args.triggerPayload,
    })
    .select("id")
    .single();

  if (insertErr || !runRow) {
    // Likely a unique-violation on (workflow_id, trigger_event_id) — same
    // event already handled by another dispatcher race. Treat as success-noop.
    return {
      runId: "skipped",
      status: "succeeded",
      scope: { trigger: args.triggerPayload },
    };
  }

  const runId = runRow.id;
  const scope: ResolutionScope = {
    trigger: args.triggerPayload,
    steps: {},
    vars: Object.fromEntries(
      Object.entries(args.spec.variables ?? {}).map(([k, v]) => [k, v.default ?? null]),
    ),
    context: {
      property_id: args.propertyId,
      user_id: args.workflowOwnerId,
      workflow_id: args.workflowId,
      run_id: runId,
    },
  };

  let cursor: string | undefined = args.spec.entry_step_id;
  let stepCount = 0;
  let runStatus: InstantRunResult["status"] = "succeeded";
  let runError: string | undefined;

  while (cursor) {
    if (stepCount++ > MAX_STEPS_PER_RUN) {
      runStatus = "failed";
      runError = `run exceeded MAX_STEPS_PER_RUN (${MAX_STEPS_PER_RUN}) — possible loop`;
      break;
    }
    const step = args.spec.steps[cursor] as StepNode | undefined;
    if (!step) {
      runStatus = "failed";
      runError = `next pointer "${cursor}" does not match any step`;
      break;
    }

    const ctx: RunnerContext = {
      propertyId: args.propertyId,
      workflowOwnerId: args.workflowOwnerId,
      workflowId: args.workflowId,
      runId,
      stepId: step.id,
      scope: scope as Record<string, unknown>,
      dryRun: args.dryRun ?? false,
    };

    try {
      const { next, output, status } = await executeStep(step, ctx, scope);
      scope.steps![step.id] = { output };
      await persistStepRun(supabase, runId, step, ctx, output, status, null);
      if (status === "filtered") {
        runStatus = "filtered";
        break;
      }
      cursor = next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await persistStepRun(supabase, runId, step, ctx, null, "failed", message);

      // on_error: 'continue' → ignore error and follow next
      // on_error: 'branch:X'  → jump to step X
      // on_error: 'fail' (default) → fail the run
      const policy = (step as { on_error?: string }).on_error ?? "fail";
      if (policy === "continue") {
        cursor = step.next;
      } else if (policy.startsWith("branch:")) {
        cursor = policy.slice("branch:".length);
      } else {
        runStatus = "failed";
        runError = message;
        break;
      }
    }
  }

  await supabase
    .from("workflow_runs")
    .update({
      status: runStatus,
      finished_at: new Date().toISOString(),
      output: scope.steps,
      error: runError ?? null,
    })
    .eq("id", runId);

  await supabase
    .from("workflows")
    .update({ last_run_at: new Date().toISOString(), last_run_status: runStatus })
    .eq("id", args.workflowId);

  return { runId, status: runStatus, error: runError, scope };
}

// ─── Step executor ──────────────────────────────────────────────────────────

async function executeStep(
  step: StepNode,
  ctx: RunnerContext,
  scope: ResolutionScope,
): Promise<{ next: string | undefined; output: unknown; status: "succeeded" | "filtered" }> {
  // Control nodes — handled inline, never hit the catalog.
  if (step.type === "control.filter") {
    const pass = evaluatePredicate((step.config as { expr: unknown }).expr, scope);
    return {
      next: pass ? step.next : undefined,
      output: { passed: pass },
      status: pass ? "succeeded" : "filtered",
    };
  }

  if (step.type === "control.branch_if") {
    const expr = (step.config as { expr: unknown }).expr;
    const result = evaluatePredicate(expr, scope);
    const target = result
      ? (step.branches as { true: string }).true
      : (step.branches as { false: string }).false;
    return { next: target, output: { branch: result ? "true" : "false" }, status: "succeeded" };
  }

  if (step.type === "control.branch_switch") {
    const input = resolveValue((step.config as { input: string }).input, scope);
    const branches = step.branches as Record<string, string>;
    const key = input === null || input === undefined ? "" : String(input);
    const target = branches[key] ?? branches._default;
    return { next: target, output: { branch: key }, status: "succeeded" };
  }

  if (step.type === "control.end") {
    return {
      next: undefined,
      output: { outcome: (step.config as { outcome?: string })?.outcome ?? null },
      status: "succeeded",
    };
  }

  if (
    step.type === "control.delay" ||
    step.type === "control.wait_for_event" ||
    step.type === "control.foreach" ||
    step.type === "control.parallel"
  ) {
    throw new Error(
      `${step.type} requires durable runtime — classifyMode() should have routed this workflow there`,
    );
  }

  // Action / AI nodes — look up the runner from the server-only registry.
  const entry = getStep(step.type);
  if (!entry) throw new Error(`step type ${step.type} not in catalog`);
  const runner = getRunner(step.type);
  if (!runner) throw new Error(`step type ${step.type} has no runner`);
  const resolvedConfig = resolveValue(step.config, scope);
  const output = await runWithRetry(step, () =>
    runner({ config: resolvedConfig, ctx }),
  );

  // AI branch decision: route based on `decision`.
  if (step.type === "ai.branch_decision") {
    const out = output as { decision?: "true" | "false" };
    const branches = (step as { branches: { true: string; false: string } }).branches;
    return {
      next: out.decision === "true" ? branches.true : branches.false,
      output,
      status: "succeeded",
    };
  }

  return { next: step.next, output, status: "succeeded" };
}

async function runWithRetry(
  step: StepNode,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  const retry = (step as { retry?: { max: number; backoff: "exp" | "linear"; initial_ms: number } })
    .retry ?? { max: 0, backoff: "exp", initial_ms: 1000 };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retry.max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retry.max) break;
      const delay =
        retry.backoff === "linear"
          ? retry.initial_ms * (attempt + 1)
          : retry.initial_ms * Math.pow(2, attempt);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastErr;
}

async function persistStepRun(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  step: StepNode,
  ctx: RunnerContext,
  output: unknown,
  status: "succeeded" | "failed" | "filtered",
  error: string | null,
): Promise<void> {
  await supabase.from("workflow_step_runs").insert({
    run_id: runId,
    step_id: step.id,
    step_type: step.type,
    status: status === "filtered" ? "succeeded" : status,
    attempt: 1,
    input: (ctx.scope as { trigger?: unknown }).trigger as Record<string, unknown> ?? {},
    output: (output ?? null) as Record<string, unknown> | null,
    error: error ? { message: error } : null,
    finished_at: new Date().toISOString(),
  });
}
