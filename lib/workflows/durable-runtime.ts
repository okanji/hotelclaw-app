import "server-only";
import { sleep, createHook, getWorkflowMetadata, FatalError } from "workflow";
import { start } from "workflow/api";
import { createServiceClient } from "@/lib/supabase/server";
import { type StepNode } from "@/lib/workflows/spec";
import { resolveValue, type ResolutionScope } from "@/lib/workflows/resolve";
import { evaluatePredicate } from "@/lib/workflows/predicate";
import { getRunner } from "@/lib/workflows/runners";
import type { RunnerContext } from "@/lib/workflows/catalog/types";
import type { InstantRunArgs } from "./instant-runtime";

/**
 * Durable runtime — executes WorkflowSpec via the Vercel Workflow SDK.
 *
 * Used when classifyMode(spec) === "durable" — workflows that contain
 * control.delay, control.wait_for_event, schedules, foreach/parallel, or
 * long AI steps. The dispatcher routes here automatically.
 *
 * Architecture mirrors instant-runtime.ts: a graph walker keyed on
 * spec.entry_step_id + step.next/branches. The differences:
 *
 *   • Runs inside a `"use workflow"` function (sandboxed) — orchestration
 *     only. All side effects (Supabase, AI, Stream) happen inside
 *     `"use step"` wrappers that have full Node.js access.
 *   • `control.delay` → `await sleep(duration)` — durable, survives deploys
 *   • `control.wait_for_event` → `createHook<T>({ token })` with a
 *     deterministic token external systems (or our own resumeHook route)
 *     can resume against
 *   • Step errors are CAUGHT inside the step wrapper and returned as
 *     `{ ok: false, error }` rather than thrown. This bypasses the
 *     workflow SDK's automatic step retry so the spec's `retry` +
 *     `on_error` policies are the sole source of retry behaviour.
 *
 * `control.foreach` and `control.parallel` run subgraphs from branch start
 * step ids until the control node's `next` merge point.
 */

const MAX_STEPS_PER_RUN = 100;

export interface DurableRunHandle {
  runId: string;
  durableRunId: string | null;
  status: "queued" | "succeeded" | "failed" | "filtered" | "cancelled";
}

// ─── Step wrappers (full Node.js access) ─────────────────────────────────────

async function createDurableRunRow(args: {
  workflowId: string;
  workflowVersionId: string;
  propertyId: string;
  triggerEventId: string | null;
  triggerKind: string;
  triggeredByUserId: string | null;
  triggerPayload: Record<string, unknown>;
  durableRunId: string;
}): Promise<string> {
  "use step";
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("workflow_runs")
    .insert({
      workflow_id: args.workflowId,
      workflow_version_id: args.workflowVersionId,
      property_id: args.propertyId,
      trigger_event_id: args.triggerEventId,
      trigger_kind: args.triggerKind,
      status: "running",
      mode: "durable",
      durable_run_id: args.durableRunId,
      triggered_by_user_id: args.triggeredByUserId,
      input: args.triggerPayload,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new FatalError(`createDurableRunRow failed: ${error?.message ?? "unknown"}`);
  }
  return data.id;
}

type StepCallResult =
  | { ok: true; output: unknown; startedAt: string; attempts: number }
  | { ok: false; error: string; startedAt: string; attempts: number };

async function executeCatalogStep(args: {
  stepType: string;
  resolvedConfig: unknown;
  runnerCtx: RunnerContext;
  retryConfig: { max: number; backoff: "exp" | "linear"; initial_ms: number };
}): Promise<StepCallResult> {
  "use step";
  // Captured inside the step (memoized), so it's a real start time without
  // breaking the workflow function's determinism.
  const startedAt = new Date().toISOString();
  const runner = getRunner(args.stepType as never);
  if (!runner) {
    return { ok: false, error: `no runner for ${args.stepType}`, startedAt, attempts: 1 };
  }
  // In-step retry — keeps the workflow's on_error policy authoritative by
  // never propagating a transient error up to the workflow loop.
  let lastErr: string | null = null;
  let attempts = 0;
  for (let attempt = 0; attempt <= args.retryConfig.max; attempt++) {
    attempts = attempt + 1;
    try {
      const output = await runner({ config: args.resolvedConfig, ctx: args.runnerCtx });
      return { ok: true, output, startedAt, attempts };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt === args.retryConfig.max) break;
      const delay =
        args.retryConfig.backoff === "linear"
          ? args.retryConfig.initial_ms * (attempt + 1)
          : args.retryConfig.initial_ms * Math.pow(2, attempt);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  return { ok: false, error: lastErr ?? "unknown", startedAt, attempts };
}

async function persistStepRunRow(args: {
  runId: string;
  stepId: string;
  stepType: string;
  status: "succeeded" | "failed";
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt?: string;
  attempts?: number;
  aiTrace?: Record<string, unknown> | null;
}): Promise<void> {
  "use step";
  const supabase = createServiceClient();
  await supabase.from("workflow_step_runs").insert({
    run_id: args.runId,
    step_id: args.stepId,
    step_type: args.stepType,
    status: args.status,
    attempt: args.attempts ?? 1,
    input: (args.input ?? {}) as Record<string, unknown>,
    output: (args.output ?? null) as Record<string, unknown> | null,
    error: args.error ? { message: args.error } : null,
    ai_trace: args.aiTrace ?? null,
    // started_at defaults to now() in the DB; only catalog steps capture a real
    // one (control steps are instantaneous, so default ≈ finished is fine).
    ...(args.startedAt ? { started_at: args.startedAt } : {}),
    finished_at: new Date().toISOString(),
  });
}

async function registerWait(args: {
  workflowId: string;
  runId: string;
  stepId: string;
  propertyId: string;
  token: string;
  eventType: string;
  correlate: Record<string, string>;
}): Promise<void> {
  "use step";
  const supabase = createServiceClient();
  // Idempotent — the token is unique. ON CONFLICT updates correlate so a
  // workflow restart after a deploy re-registers cleanly.
  await supabase
    .from("workflow_waits")
    .upsert(
      {
        workflow_id: args.workflowId,
        run_id: args.runId,
        step_id: args.stepId,
        property_id: args.propertyId,
        token: args.token,
        event_type: args.eventType,
        correlate: args.correlate,
      },
      { onConflict: "token" },
    );
}

async function disposeWait(token: string): Promise<void> {
  "use step";
  const supabase = createServiceClient();
  await supabase.from("workflow_waits").delete().eq("token", token);
}

async function finalizeRunRow(args: {
  runId: string;
  workflowId: string;
  status: "succeeded" | "failed" | "filtered" | "cancelled";
  error: string | null;
  errorStepId?: string | null;
  output: Record<string, unknown> | null;
}): Promise<void> {
  "use step";
  const supabase = createServiceClient();
  await supabase
    .from("workflow_runs")
    .update({
      status: args.status,
      finished_at: new Date().toISOString(),
      output: args.output,
      error: args.error,
      error_step_id: args.errorStepId ?? null,
    })
    .eq("id", args.runId);
  await supabase
    .from("workflows")
    .update({ last_run_at: new Date().toISOString(), last_run_status: args.status })
    .eq("id", args.workflowId);
}

// ─── The orchestrator ───────────────────────────────────────────────────────

/**
 * Generic durable workflow over a WorkflowSpec. Bundled separately by the
 * SWC transform; runs inside the Workflow SDK sandbox. Only pure JS +
 * imported workflow primitives + step wrappers are allowed.
 */
export async function runWorkflowSpec(args: InstantRunArgs): Promise<{
  runId: string;
  status: "succeeded" | "failed" | "filtered" | "cancelled";
}> {
  "use workflow";

  const meta = getWorkflowMetadata();
  const durableRunId = meta.workflowRunId;

  const runId = await createDurableRunRow({
    workflowId: args.workflowId,
    workflowVersionId: args.workflowVersionId,
    propertyId: args.propertyId,
    triggerEventId: args.triggerEventId,
    triggerKind: args.spec.trigger.event_type,
    triggeredByUserId: args.triggeredByUserId ?? null,
    triggerPayload: args.triggerPayload,
    durableRunId,
  });

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
      durable_run_id: durableRunId,
    },
  };

  let cursor: string | undefined = args.spec.entry_step_id;
  let stepCount = 0;
  let runStatus: "succeeded" | "failed" | "filtered" | "cancelled" = "succeeded";
  let runError: string | null = null;
  let errorStepId: string | null = null;

  while (cursor) {
    if (stepCount++ > MAX_STEPS_PER_RUN) {
      runStatus = "failed";
      runError = `run exceeded MAX_STEPS_PER_RUN (${MAX_STEPS_PER_RUN})`;
      break;
    }
    const step = args.spec.steps[cursor] as StepNode | undefined;
    if (!step) {
      runStatus = "failed";
      runError = `next pointer "${cursor}" does not match any step`;
      break;
    }

    const stepResult = await executeStepDurable(step, scope, runId, args);
    if (!stepResult.ok) {
      await persistStepRunRow({
        runId,
        stepId: step.id,
        stepType: step.type,
        status: "failed",
        input: stepResult.input ?? {},
        output: null,
        error: stepResult.error,
        startedAt: stepResult.startedAt,
        attempts: stepResult.attempts,
      });
      const policy = (step as { on_error?: string }).on_error ?? "fail";
      if (policy === "continue") {
        cursor = (step as { next?: string }).next;
        continue;
      }
      if (policy.startsWith("branch:")) {
        cursor = policy.slice("branch:".length);
        continue;
      }
      runStatus = "failed";
      runError = stepResult.error;
      errorStepId = step.id;
      break;
    }

    if (stepResult.persisted !== false) {
      await persistStepRunRow({
        runId,
        stepId: step.id,
        stepType: step.type,
        status: "succeeded",
        input: stepResult.input ?? {},
        output: stepResult.output,
        error: null,
        startedAt: stepResult.startedAt,
        attempts: stepResult.attempts,
        aiTrace: stepResult.aiTrace,
      });
    }
    scope.steps![step.id] = { output: stepResult.output };
    if (stepResult.status === "filtered") {
      runStatus = "filtered";
      break;
    }
    cursor = stepResult.next;
  }

  await finalizeRunRow({
    runId,
    workflowId: args.workflowId,
    status: runStatus,
    error: runError,
    errorStepId,
    output: (scope.steps ?? null) as Record<string, unknown> | null,
  });

  return { runId, status: runStatus };
}

type StepResult =
  | {
      ok: true;
      next: string | undefined;
      output: unknown;
      status: "succeeded" | "filtered";
      input: unknown;
      persisted?: boolean;
      startedAt?: string;
      attempts?: number;
      aiTrace?: Record<string, unknown> | null;
    }
  | { ok: false; error: string; input: unknown; startedAt?: string; attempts?: number };

async function executeStepDurable(
  step: StepNode,
  scope: ResolutionScope,
  runId: string,
  args: InstantRunArgs,
): Promise<StepResult> {
  // Control nodes — pure, evaluated inline. Safe in workflow context.
  if (step.type === "control.filter") {
    const pass = evaluatePredicate((step.config as { expr: unknown }).expr, scope);
    return {
      ok: true,
      next: pass ? (step as { next?: string }).next : undefined,
      output: { passed: pass },
      status: pass ? "succeeded" : "filtered",
      input: { expr: (step.config as { expr: unknown }).expr },
    };
  }
  if (step.type === "control.branch_if") {
    const result = evaluatePredicate((step.config as { expr: unknown }).expr, scope);
    const branches = step.branches as { true: string; false: string };
    return {
      ok: true,
      next: result ? branches.true : branches.false,
      output: { branch: result ? "true" : "false" },
      status: "succeeded",
      input: { expr: (step.config as { expr: unknown }).expr },
    };
  }
  if (step.type === "control.branch_switch") {
    const input = resolveValue((step.config as { input: string }).input, scope);
    const branches = step.branches as Record<string, string>;
    const key = input === null || input === undefined ? "" : String(input);
    const target = branches[key] ?? branches._default;
    return {
      ok: true,
      next: target,
      output: { branch: key },
      status: "succeeded",
      input: { value: key },
    };
  }
  if (step.type === "control.end") {
    return {
      ok: true,
      next: undefined,
      output: { outcome: (step.config as { outcome?: string })?.outcome ?? null },
      status: "succeeded",
      input: {},
    };
  }

  // Durable-only: delay → workflow SDK sleep
  if (step.type === "control.delay") {
    const duration = (step.config as { duration: string }).duration;
    await sleep(duration as `${number}${"s" | "m" | "h" | "d"}`);
    return {
      ok: true,
      next: (step as { next?: string }).next,
      output: { slept_for: duration },
      status: "succeeded",
      input: { duration },
    };
  }

  // Durable-only: wait_for_event → createHook with a deterministic token.
  // Two resume paths:
  //   1. External system POSTs to /api/workflows/hooks/[token]
  //   2. Dispatcher auto-resumes via workflow_waits table when a matching
  //      workflow_event arrives (resolves correlate paths against payload)
  if (step.type === "control.wait_for_event") {
    const cfg = step.config as {
      event_type: string;
      timeout?: string;
      correlate?: Record<string, string>;
    };
    const token = `wf:${args.workflowId}:${runId}:${step.id}`;

    // Resolve correlate values against the current scope so the wait knows
    // exactly which incoming event payload to match against.
    const resolvedCorrelate: Record<string, string> = {};
    for (const [path, value] of Object.entries(cfg.correlate ?? {})) {
      const resolved = resolveValue(value, scope);
      resolvedCorrelate[path] = resolved === null || resolved === undefined ? "" : String(resolved);
    }

    await registerWait({
      workflowId: args.workflowId,
      runId,
      stepId: step.id,
      propertyId: args.propertyId,
      token,
      eventType: cfg.event_type,
      correlate: resolvedCorrelate,
    });

    const hook = createHook<Record<string, unknown>>({ token });

    // Enforce the optional timeout by racing the hook against a durable sleep.
    // Without this the run waits forever if the correlated event never arrives
    // (showing "running" indefinitely with no recourse). On timeout we stop
    // waiting and continue with received:false so downstream steps can branch.
    let eventPayload: Record<string, unknown> | null = null;
    let timedOut = false;
    if (cfg.timeout) {
      const raced = await Promise.race([
        hook.then((payload) => ({ kind: "event" as const, payload })),
        sleep(cfg.timeout as `${number}${"s" | "m" | "h" | "d"}`).then(
          () => ({ kind: "timeout" as const }),
        ),
      ]);
      if (raced.kind === "timeout") timedOut = true;
      else eventPayload = raced.payload;
    } else {
      eventPayload = await hook;
    }
    await disposeWait(token);

    return {
      ok: true,
      next: (step as { next?: string }).next,
      output: timedOut
        ? { received: false, timed_out: true, event_type: cfg.event_type, token }
        : { received: true, event: eventPayload, event_type: cfg.event_type, token },
      status: "succeeded",
      input: {
        event_type: cfg.event_type,
        correlate: resolvedCorrelate,
        token,
        timeout: cfg.timeout ?? null,
      },
    };
  }

  if (step.type === "control.foreach") {
    const cfg = step.config as {
      items: string;
      item_var?: string;
      body_start: string;
    };
    const rawItems = resolveValue(cfg.items, scope);
    if (!Array.isArray(rawItems)) {
      return {
        ok: false,
        error: "foreach items must resolve to an array",
        input: cfg,
      };
    }
    const itemVar = cfg.item_var ?? "item";
    const mergeNext = (step as { next?: string }).next;
    const iterationOutputs: Record<string, unknown>[] = [];

    for (const item of rawItems) {
      scope.vars = { ...(scope.vars ?? {}), [itemVar]: item };
      const sub = await runSubgraphDurable({
        startId: cfg.body_start,
        mergeId: mergeNext,
        scope,
        runId,
        workflowArgs: args,
      });
      if (!sub.ok) {
        return { ok: false, error: sub.error, input: cfg };
      }
      iterationOutputs.push(sub.outputs);
    }

    return {
      ok: true,
      next: mergeNext,
      output: { iterations: rawItems.length, results: iterationOutputs },
      status: "succeeded",
      input: { items: rawItems, item_var: itemVar, body_start: cfg.body_start },
    };
  }

  if (step.type === "control.parallel") {
    const cfg = step.config as {
      branches: string[];
      join?: "all" | "any";
    };
    const mergeNext = (step as { next?: string }).next;
    const join = cfg.join ?? "all";

    const runBranch = async (branchStart: string) => {
      const branchScope: ResolutionScope = {
        trigger: scope.trigger,
        steps: { ...(scope.steps ?? {}) },
        vars: { ...(scope.vars ?? {}) },
        context: scope.context,
      };
      return runSubgraphDurable({
        startId: branchStart,
        mergeId: mergeNext,
        scope: branchScope,
        runId,
        workflowArgs: args,
      });
    };

    if (join === "any") {
      try {
        const winner = await Promise.race(
          cfg.branches.map((branchStart) =>
            runBranch(branchStart).then((result) => {
              if (!result.ok) throw new Error(result.error);
              return { branchStart, result };
            }),
          ),
        );
        for (const [stepId, output] of Object.entries(winner.result.outputs)) {
          scope.steps![stepId] = { output };
        }
        return {
          ok: true,
          next: mergeNext,
          output: { completed: [winner.branchStart], join },
          status: "succeeded",
          input: cfg,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "all parallel branches failed",
          input: cfg,
        };
      }
    }

    const branchResults = await Promise.all(cfg.branches.map(runBranch));
    for (const result of branchResults) {
      if (!result.ok) {
        return { ok: false, error: result.error, input: cfg };
      }
      for (const [stepId, output] of Object.entries(result.outputs)) {
        scope.steps![stepId] = { output };
      }
    }

    return {
      ok: true,
      next: mergeNext,
      output: { completed: cfg.branches, join },
      status: "succeeded",
      input: cfg,
    };
  }

  // Action / AI nodes — runner call inside a step
  const resolvedConfig = resolveValue(step.config, scope);
  const runnerCtx: RunnerContext = {
    propertyId: args.propertyId,
    workflowOwnerId: args.workflowOwnerId,
    workflowId: args.workflowId,
    runId,
    stepId: step.id,
    scope: scope as Record<string, unknown>,
    dryRun: false,
  };
  const retry = (step as { retry?: { max: number; backoff: "exp" | "linear"; initial_ms: number } })
    .retry ?? { max: 0, backoff: "exp", initial_ms: 1000 };

  const result = await executeCatalogStep({
    stepType: step.type,
    resolvedConfig,
    runnerCtx,
    retryConfig: retry,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      input: resolvedConfig,
      startedAt: result.startedAt,
      attempts: result.attempts,
    };
  }

  // ai.branch_decision routes via the decision field.
  if (step.type === "ai.branch_decision") {
    const out = result.output as { decision?: "true" | "false" };
    const branches = (step as { branches: { true: string; false: string } }).branches;
    return {
      ok: true,
      next: out.decision === "true" ? branches.true : branches.false,
      output: result.output,
      status: "succeeded",
      input: resolvedConfig,
      startedAt: result.startedAt,
      attempts: result.attempts,
    };
  }

  return {
    ok: true,
    next: (step as { next?: string }).next,
    output: result.output,
    status: "succeeded",
    input: resolvedConfig,
    startedAt: result.startedAt,
    attempts: result.attempts,
  };
}

const MAX_SUBGRAPH_STEPS = 25;

async function runSubgraphDurable(args: {
  startId: string;
  mergeId: string | undefined;
  scope: ResolutionScope;
  runId: string;
  workflowArgs: InstantRunArgs;
}): Promise<
  | { ok: true; outputs: Record<string, unknown> }
  | { ok: false; error: string }
> {
  let cursor: string | undefined = args.startId;
  let count = 0;
  const outputs: Record<string, unknown> = {};

  while (cursor) {
    if (cursor === args.mergeId) break;
    if (count++ >= MAX_SUBGRAPH_STEPS) {
      return { ok: false, error: `subgraph exceeded max steps (${MAX_SUBGRAPH_STEPS})` };
    }

    const step = args.workflowArgs.spec.steps[cursor] as StepNode | undefined;
    if (!step) {
      return { ok: false, error: `subgraph step "${cursor}" not found` };
    }

    const stepResult = await executeStepDurable(
      step,
      args.scope,
      args.runId,
      args.workflowArgs,
    );
    if (!stepResult.ok) {
      return { ok: false, error: stepResult.error };
    }

    if (stepResult.persisted !== false) {
      await persistStepRunRow({
        runId: args.runId,
        stepId: step.id,
        stepType: step.type,
        status: "succeeded",
        input: stepResult.input ?? {},
        output: stepResult.output,
        error: null,
      });
    }

    args.scope.steps![step.id] = { output: stepResult.output };
    outputs[step.id] = stepResult.output;

    if (stepResult.status === "filtered") break;
    cursor = stepResult.next;
    if (cursor === args.mergeId) break;
  }

  return { ok: true, outputs };
}

// ─── Public API — called by dispatcher ──────────────────────────────────────

export async function runWorkflowDurable(args: InstantRunArgs): Promise<DurableRunHandle> {
  const run = await start(runWorkflowSpec, [args]);
  return { runId: run.runId, durableRunId: run.runId, status: "queued" };
}

/**
 * Mid-run promotion entry point — when the instant runtime decides a step
 * needs durable execution (long delay surfaces, AI step exceeds budget, …)
 * it re-enqueues here with the same args. v1 just starts a fresh durable
 * run; v1.1 can preserve scope state.
 */
export async function promoteToDurable(args: InstantRunArgs): Promise<DurableRunHandle> {
  return runWorkflowDurable(args);
}
