"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ChevronDown, FlaskConical, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Gi } from "@/components/gr8r/icon";
import { RunBadge } from "@/components/workflows/g8-bits";
import { runStatusLabel, triggerLabel } from "@/lib/workflows/summary";
import { createClient } from "@/lib/supabase/client";
import { getStep } from "@/lib/workflows/catalog";
import { SurfaceBadge } from "@/components/workflows/builder/surface-badge";
import { RunStatusRing } from "@/components/workflows/run-status-ring";
import { formatDuration } from "@/components/workflows/run-format";
import { AiShimmerLabel } from "@/components/ui/ai-loader";

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
    <div className="stack" style={{ gap: 14 }}>
      <header className="row" style={{ flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <RunBadge status={run.status} label={runStatusLabel(run.status)} />
          {run.is_dry_run ? (
            <span className="badge gray" title="Test run — no side effects, excluded from stats">
              <Gi icon={FlaskConical} size={12} />
              test run
            </span>
          ) : null}
          <span className="muted" style={{ fontSize: 12 }}>
            Trigger: {triggerLabel(run.trigger_kind) ?? "Manual run"} ·{" "}
            {formatDuration(run.started_at, run.finished_at, "running…")}
            {run.mode === "durable" ? " · can wait between steps" : ""}
          </span>
        </div>
        <span className="sp" />
        <div className="row" style={{ gap: 6 }}>
          {active ? (
            <button
              type="button"
              className="btn btn-danger-ghost btn-sm"
              onClick={cancel}
              disabled={running}
              title="Stop this run"
            >
              <Gi icon={Ban} size={14} />
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => rerun(true)}
            disabled={running}
            title="Replay this run's data with no side effects"
          >
            <Gi icon={FlaskConical} size={14} />
            Test
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => rerun(false)}
            disabled={running}
            title="Replay this run's data for real"
          >
            <Gi icon={RotateCw} size={14} />
            Re-run
          </button>
        </div>
      </header>

      {run.error ? (
        <div className="alert danger">
          <span>{run.error}</span>
        </div>
      ) : null}

      <ol className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {steps.map((s, i) => (
          <StepRunRow key={s.id} step={s} ordinal={i + 1} />
        ))}
        {steps.length === 0 ? (
          <li className="empty-state sm">
            <p>No steps recorded yet.</p>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function StepRunRow({ step, ordinal }: { step: StepRow; ordinal: number }) {
  const entry = getStep(step.step_type as never);
  const [open, setOpen] = useState(false);
  const running = step.status === "running";

  return (
    <li style={{ borderTop: ordinal > 1 ? "1px solid var(--g8-divider)" : undefined }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="nrow"
        style={{ width: "100%", alignItems: "center", textAlign: "left", padding: "9px 14px" }}
      >
        <RunStatusRing status={step.status} size={22}>
          {ordinal}
        </RunStatusRing>
        <SurfaceBadge surface={entry?.surface ?? "system"} />
        <div className="col grow" style={{ gap: 2 }}>
          {running ? (
            <AiShimmerLabel className="truncate">
              {entry?.label ?? step.step_type}
            </AiShimmerLabel>
          ) : (
            <span className="trunc" style={{ fontWeight: 500 }}>
              {entry?.label ?? step.step_type}
            </span>
          )}
          <span className="trunc faint mono" style={{ fontSize: 11.5 }}>
            {step.step_id}
            {branchTaken(step) ? (
              <span className="muted" style={{ marginLeft: 8 }}>
                → took “{branchTaken(step)}” path
              </span>
            ) : null}
          </span>
        </div>
        {step.attempt > 1 ? (
          <span className="badge amber" title={`Succeeded or failed after ${step.attempt} attempts`}>
            ×{step.attempt}
          </span>
        ) : null}
        <span className="faint num" style={{ fontSize: 12 }}>
          {formatDuration(step.started_at, step.finished_at, "running…")}
        </span>
        <RunBadge status={step.status} label={runStatusLabel(step.status)} />
        <span className="faint" style={{ display: "inline-flex" }}>
          <Gi
            icon={ChevronDown}
            size={14}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {open ? (
        <div
          className="grid grid-cols-[22px_1fr] gap-x-3"
          style={{ borderTop: "1px solid var(--g8-divider)", padding: "10px 14px 12px", fontSize: 12 }}
        >
          <span aria-hidden className="mx-auto h-full w-px" style={{ background: "var(--g8-border)" }} />
          <div className="stack" style={{ gap: 12, minWidth: 0 }}>
            {step.error ? (
              <Section title="What went wrong" tone="destructive">
                <p style={{ margin: 0, fontSize: 13 }}>{humanizeStepError(step.error)}</p>
                <details style={{ marginTop: 8 }}>
                  <summary className="faint" style={{ cursor: "pointer", userSelect: "none" }}>
                    Technical details
                  </summary>
                  <pre className="mono" style={PRE_DANGER}>
                    {JSON.stringify(step.error, null, 2)}
                  </pre>
                </details>
              </Section>
            ) : null}
            {step.output !== null ? (
              <Section title="Output">
                <pre className="mono" style={PRE}>
                  {JSON.stringify(step.output, null, 2)}
                </pre>
              </Section>
            ) : null}
            {step.ai_trace ? (
              <Section title="AI trace">
                <pre className="mono" style={PRE}>
                  {JSON.stringify(step.ai_trace, null, 2)}
                </pre>
              </Section>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

const PRE: React.CSSProperties = {
  margin: 0,
  maxHeight: 256,
  overflow: "auto",
  borderRadius: "var(--g8-r-sm)",
  background: "var(--g8-surface-2)",
  border: "1px solid var(--g8-border)",
  padding: 8,
  whiteSpace: "pre-wrap",
  fontSize: 11.5,
};
const PRE_DANGER: React.CSSProperties = {
  ...PRE,
  marginTop: 6,
  background: "var(--g8-red-soft)",
  borderColor: "transparent",
  color: "var(--g8-red)",
};

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
    <div style={{ minWidth: 0 }}>
      <div
        className="faint"
        style={{
          marginBottom: 4,
          fontSize: 12,
          fontWeight: 500,
          color: tone === "destructive" ? "var(--g8-red)" : undefined,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
