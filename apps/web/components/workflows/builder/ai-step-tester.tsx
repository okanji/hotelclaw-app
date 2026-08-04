"use client";

import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { sampleTriggerPayload } from "@/lib/workflows/refs";
import { useWorkflowBuilderData } from "./workflow-builder-data";

/**
 * "Test this step" — runs a single AI step in isolation against a sample
 * trigger payload (via /workflows/step-test) so prompt wording can be
 * iterated without dry-running the whole workflow. AI steps only: they're
 * side-effect-free, so real execution is safe.
 */
export function AiStepTester({
  stepType,
  config,
  spec,
}: {
  stepType: string;
  config: Record<string, unknown>;
  spec: WorkflowSpec;
}) {
  const builderData = useWorkflowBuilderData();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ output: unknown; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const propertyId = builderData?.propertyId;
  if (!propertyId) return null;

  async function runTest() {
    if (running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/workflows/step-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepType,
          config,
          triggerPayload: sampleTriggerPayload(spec),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        output?: unknown;
        ms?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult({ output: data.output, ms: data.ms ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-3 rounded-md bg-muted p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Try this step with sample trigger data. Data from earlier steps isn’t
          available in a step test.
        </p>
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={running}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <FlaskConical className="size-3" aria-hidden />
          )}
          Test this step
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-faint-foreground">
            <span>Result</span>
            <span className="tabular-nums normal-case">{(result.ms / 1000).toFixed(1)}s</span>
          </div>
          <pre className="max-h-48 overflow-auto rounded-sm bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
            {formatOutput(result.output)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** Single-string outputs ({ text } / { summary }) render as prose, not JSON. */
function formatOutput(output: unknown): string {
  if (output && typeof output === "object") {
    const entries = Object.entries(output as Record<string, unknown>);
    if (entries.length === 1 && typeof entries[0]![1] === "string") {
      return entries[0]![1] as string;
    }
  }
  return JSON.stringify(output, null, 2);
}
