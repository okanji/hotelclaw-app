import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { getRunner } from "@/lib/workflows/runners";
import { resolveValue, type ResolutionScope } from "@/lib/workflows/resolve";
import type { RunnerContext } from "@/lib/workflows/catalog/types";

// POST /api/properties/:propertyId/workflows/step-test
//
// Run a SINGLE step in isolation against a sample trigger payload, so authors
// can iterate on AI prompts without dry-running the whole workflow. Restricted
// to ai.* steps: they're side-effect-free by construction (model calls only),
// so a real execution is safe. Action steps must go through the workflow-level
// dry run, which routes them through their dryRun guards.
//
// Refs to other steps' outputs ({{steps.x.output.*}}) resolve to empty here —
// only the trigger payload is available. The UI says so.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: {
    stepType?: string;
    config?: Record<string, unknown>;
    triggerPayload?: Record<string, unknown>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const stepType = body.stepType ?? "";
  if (!stepType.startsWith("ai.")) {
    return NextResponse.json(
      { error: "Only AI steps can be tested in isolation." },
      { status: 400 },
    );
  }
  const runner = getRunner(stepType as never);
  if (!runner) {
    return NextResponse.json({ error: `unknown step type ${stepType}` }, { status: 404 });
  }

  const scope: ResolutionScope = {
    trigger: body.triggerPayload ?? {},
    steps: {},
    vars: {},
    context: { property_id: propertyId, user_id: user.id },
  };

  let trace: Record<string, unknown> | null = null;
  const ctx: RunnerContext = {
    propertyId,
    workflowOwnerId: user.id,
    workflowId: "step-test",
    runId: "step-test",
    stepId: "step-test",
    scope: scope as Record<string, unknown>,
    dryRun: false,
    recordTrace: (t) => {
      trace = t;
    },
  };

  const startedAt = Date.now();
  try {
    const resolvedConfig = resolveValue(body.config ?? {}, scope);
    const output = await runner({ config: resolvedConfig, ctx });
    return NextResponse.json({
      output,
      ms: Date.now() - startedAt,
      trace,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "step failed" },
      { status: 400 },
    );
  }
}
