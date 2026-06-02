"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ChevronDown, FlaskConical, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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

const STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive",
  running: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  queued: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
  filtered: "bg-muted text-muted-foreground",
  waiting: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  cancelled: "bg-muted text-muted-foreground",
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
          <span
            className={cn(
              "inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium",
              STATUS_COLORS[run.status] ?? "bg-muted text-muted-foreground",
            )}
          >
            {run.status}
          </span>
          <span className="text-[12px] text-muted-foreground">
            Triggered by {run.trigger_kind ?? "—"} ·{" "}
            {formatDuration(run.started_at, run.finished_at)} · {run.mode}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {active ? (
            <button
              type="button"
              onClick={cancel}
              disabled={running}
              title="Stop this run"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[12px] hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Ban className="size-3" aria-hidden />
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => rerun(true)}
            disabled={running}
            title="Replay this run's data with no side effects"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[12px] hover:bg-muted disabled:opacity-50"
          >
            <FlaskConical className="size-3" aria-hidden />
            Test
          </button>
          <button
            type="button"
            onClick={() => rerun(false)}
            disabled={running}
            title="Replay this run's data for real"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[12px] hover:bg-muted disabled:opacity-50"
          >
            <RotateCw className="size-3" aria-hidden />
            Re-run
          </button>
        </div>
      </header>

      {run.error ? (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {run.error}
        </div>
      ) : null}

      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <StepRunRow key={s.id} step={s} ordinal={i + 1} />
        ))}
        {steps.length === 0 ? (
          <li className="rounded-md border border-dashed border-border/60 p-6 text-center text-[12px] text-muted-foreground">
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
    <li className="rounded-md border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px]"
      >
        <span className="w-5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
          {ordinal}
        </span>
        <SurfaceBadge surface={entry?.surface ?? "system"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {entry?.label ?? step.step_type}
            </span>
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {step.step_id}
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatDuration(step.started_at, step.finished_at)}
        </span>
        <span
          className={cn(
            "inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium",
            STATUS_COLORS[step.status] ?? "bg-muted text-muted-foreground",
          )}
        >
          {step.status}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-t border-border/60 p-3 text-[12px]">
          {step.error ? (
            <Section title="What went wrong" tone="destructive">
              <p className="font-sans">{humanizeStepError(step.error)}</p>
              <details className="mt-2">
                <summary className="cursor-pointer font-sans text-[10px] uppercase tracking-wide opacity-70 select-none">
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
          "mb-1 text-[10px] font-medium uppercase tracking-wide",
          tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {title}
      </div>
      <div
        className={cn(
          "rounded-sm bg-muted/40 p-2 font-mono text-[11px] text-foreground",
          tone === "destructive" && "bg-destructive/10 text-destructive",
        )}
      >
        {children}
      </div>
    </div>
  );
}
