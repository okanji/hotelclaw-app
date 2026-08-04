"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ChevronDown, FlaskConical, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { createClient } from "@/lib/supabase/client";
import { getStep } from "@/lib/workflows/catalog";
import { SurfaceBadge } from "@/components/workflows/builder/surface-badge";

// Read-only run inspector. Subscribes to workflow_runs + workflow_step_runs
// via Supabase Realtime so in-flight runs live-tail without polling.

type RunRow = {
  id: string;
  status: string;
  mode: string;
  trigger_kind: string | null;
  durable_run_id: string | null;
  is_dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
};

type StepRow = {
  id: string;
  run_id: string;
  step_id: string;
  step_type: string;
  status: string;
  attempt: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  ai_trace: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
};

/** Run/step lifecycle status → house StatusBadge tone. */
const STATUS_TONES: Record<
  string,
  React.ComponentProps<typeof StatusBadge>["tone"]
> = {
  succeeded: "success",
  failed: "danger",
  running: "info",
  queued: "neutral",
  skipped: "neutral",
  filtered: "neutral",
  waiting: "warning",
  cancelled: "neutral",
};

function formatDuration(start: string, end: string | null) {
  if (!end) return "running…";
  const ms = Date.parse(end) - Date.parse(start);
  if (isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function RunInspectorClient({
  propertyId,
  workflowId,
  initialRun,
  initialSteps,
}: {
  propertyId: string;
  workflowId: string;
  initialRun: RunRow;
  initialSteps: StepRow[];
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunRow>(initialRun);
  const [steps, setSteps] = useState<StepRow[]>(initialSteps);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    // Live-tail only while the run is active. Once finished, no need to subscribe.
    const isActive = run.status === "running" || run.status === "queued" || run.status === "waiting";
    if (!isActive) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`workflow-run:${run.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_runs",
          filter: `id=eq.${run.id}`,
        },
        (payload) => {
          const next = payload.new as RunRow;
          setRun((prev) => ({ ...prev, ...next }));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_step_runs",
          filter: `run_id=eq.${run.id}`,
        },
        (payload) => {
          const next = payload.new as StepRow;
          setSteps((prev) => {
            const idx = prev.findIndex((s) => s.id === next.id);
            if (idx >= 0) {
              const merged = [...prev];
              merged[idx] = { ...prev[idx], ...next };
              return merged;
            }
            return [...prev, next];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [run.id, run.status]);

  const active =
    run.status === "running" || run.status === "waiting" || run.status === "queued";

  async function cancel() {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/workflows/${workflowId}/runs/${run.id}/cancel`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Run cancelled");
      setRun((prev) => ({ ...prev, status: "cancelled" }));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel");
    } finally {
      setRunning(false);
    }
  }

  // Replay this run's exact trigger payload through the current spec. `dryRun`
  // produces synthetic output with no side effects (a safe test); otherwise it's
  // a real re-run. Either way we land on the freshly-created run.
  async function rerun(dryRun: boolean) {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/workflows/${workflowId}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replayRunId: run.id, dryRun }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(dryRun ? "Test run complete — no side effects" : "Re-run started");
      if (data.runId && data.runId !== "skipped") {
        router.push(`/p/${propertyId}/workflows/${workflowId}/runs/${data.runId}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <StatusBadge tone={STATUS_TONES[run.status] ?? "neutral"}>
            {run.status}
          </StatusBadge>
          {run.is_dry_run ? (
            <Badge
              variant="outline"
              className="text-muted-foreground"
              title="Test run — no side effects, excluded from stats"
            >
              <FlaskConical aria-hidden />
              test run
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            Triggered by {run.trigger_kind ?? "—"} ·{" "}
            {formatDuration(run.started_at, run.finished_at)} · {run.mode}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {active ? (
            <Button
              variant="outline"
              size="xs"
              onClick={cancel}
              disabled={running}
              title="Stop this run"
              className="hover:bg-destructive/10 hover:text-destructive"
            >
              <Ban data-icon="inline-start" aria-hidden />
              Cancel
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            onClick={() => rerun(true)}
            disabled={running}
            title="Replay this run's data with no side effects"
          >
            <FlaskConical data-icon="inline-start" aria-hidden />
            Test
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => rerun(false)}
            disabled={running}
            title="Replay this run's data for real"
          >
            <RotateCw data-icon="inline-start" aria-hidden />
            Re-run
          </Button>
        </div>
      </header>

      {run.error ? (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {run.error}
        </div>
      ) : null}

      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <StepRunRow key={s.id} step={s} ordinal={i + 1} />
        ))}
        {steps.length === 0 ? (
          <li className="rounded-md bg-muted p-6 text-center text-sm text-muted-foreground">
            No steps recorded yet.
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function StepRunRow({ step, ordinal }: { step: StepRow; ordinal: number }) {
  const entry = getStep(step.step_type as never);
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-md bg-card shadow-ring">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
      >
        <span className="w-5 text-right font-mono text-xs text-muted-foreground tabular-nums">
          {ordinal}
        </span>
        <SurfaceBadge surface={entry?.surface ?? "system"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {entry?.label ?? step.step_type}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {step.step_id}
            {branchTaken(step) ? (
              <span className="ml-2 text-foreground/70">→ took “{branchTaken(step)}” path</span>
            ) : null}
          </div>
        </div>
        {step.attempt > 1 ? (
          <StatusBadge
            tone="warning"
            dot={false}
            title={`Succeeded or failed after ${step.attempt} attempts`}
          >
            ×{step.attempt}
          </StatusBadge>
        ) : null}
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDuration(step.started_at, step.finished_at)}
        </span>
        <StatusBadge tone={STATUS_TONES[step.status] ?? "neutral"}>
          {step.status}
        </StatusBadge>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-t border-border p-3 text-xs">
          {step.error ? (
            <Section title="What went wrong" tone="destructive">
              <p className="font-sans">{humanizeStepError(step.error)}</p>
              <details className="mt-2">
                <summary className="cursor-pointer font-sans text-xs text-faint-foreground select-none">
                  Technical details
                </summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(step.error, null, 2)}
                </pre>
              </details>
            </Section>
          ) : null}
          {step.output !== null ? (
            <Section title="Output">
              <pre className="overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(step.output, null, 2)}
              </pre>
            </Section>
          ) : null}
          {step.ai_trace ? (
            <Section title="AI trace">
              <pre className="overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(step.ai_trace, null, 2)}
              </pre>
            </Section>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Branch/filter steps record which path they routed to in output.branch.
 * Surfacing it inline answers "which way did this run go?" without opening
 * the step's output JSON.
 */
function branchTaken(step: StepRow): string | null {
  if (!step.step_type.startsWith("control.branch") && step.step_type !== "ai.branch_decision") {
    return null;
  }
  const branch = (step.output as { branch?: unknown; decision?: unknown } | null)?.branch
    ?? (step.output as { decision?: unknown } | null)?.decision;
  return typeof branch === "string" && branch.length > 0 ? branch : null;
}

/**
 * Turn a stored step error ({ message } in practice) into a sentence a
 * non-technical user can act on. Known runtime messages get a friendlier
 * rewrite; everything else is shown as-is with a capital and full stop.
 */
function humanizeStepError(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : typeof error === "string"
        ? error
        : "";

  if (!raw) return "This step failed. Open the technical details below to see what happened.";

  const lower = raw.toLowerCase();
  if (lower.includes("no runner for")) {
    return "This step type isn’t available to run. It may have been removed or renamed — try re-adding it in the builder.";
  }
  if (lower.includes("must resolve to an array")) {
    return "The “Repeat for each item” step expected a list to loop over, but didn’t get one. Check what you pointed it at.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "This step took too long and timed out before it finished.";
  }
  if (lower.includes("required") || lower.includes("non-empty") || lower.includes("expected")) {
    return `A setting on this step wasn’t filled in correctly: ${raw}`;
  }

  const sentence = raw.charAt(0).toUpperCase() + raw.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "destructive";
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div
        className={cn(
          "mb-1 text-xs font-medium",
          tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {title}
      </div>
      <div
        className={cn(
          "rounded-md bg-muted p-2 font-mono text-xs text-foreground",
          tone === "destructive" && "bg-destructive/10 text-destructive",
        )}
      >
        {children}
      </div>
    </div>
  );
}
