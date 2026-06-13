"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkflowSpec } from "@/lib/workflows/spec";
import { sampleTriggerPayload } from "@/lib/workflows/refs";
import { getTrigger } from "@/lib/workflows/catalog";

/**
 * "Test this workflow" — dry-runs the saved spec with an editable sample
 * trigger payload, so a workflow can be exercised before it has ever fired
 * for real. The payload is pre-filled from the same curated field catalog
 * the data-picker uses (sampleTriggerPayload), the run executes with
 * dryRun=true (runners return synthetic output, no side effects), and we
 * land on the run inspector to watch it live.
 */
export function TestRunDialog({
  propertyId,
  workflowId,
  spec,
  dirty,
  open,
  onClose,
}: {
  propertyId: string;
  workflowId: string;
  spec: WorkflowSpec;
  /** True when the builder has unsaved edits — the test runs the saved version. */
  dirty: boolean;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      {/* Override both of the base width caps (max-w-[…] AND sm:max-w-sm) —
          overriding only one leaves the panel narrower than its content. */}
      <DialogContent className="w-full max-w-[calc(100%-2rem)] sm:max-w-lg">
        {/* DialogContent unmounts on close, so the body remounts on every
            open — its lazy useState re-seeds the sample payload from the
            current spec without an effect. */}
        <TestRunDialogBody
          propertyId={propertyId}
          workflowId={workflowId}
          spec={spec}
          dirty={dirty}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function TestRunDialogBody({
  propertyId,
  workflowId,
  spec,
  dirty,
  onClose,
}: {
  propertyId: string;
  workflowId: string;
  spec: WorkflowSpec;
  dirty: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(() =>
    JSON.stringify(sampleTriggerPayload(spec), null, 2),
  );
  const [running, setRunning] = useState(false);

  const parseError = useMemo(() => {
    if (!text.trim()) return "Payload can't be empty.";
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "Payload must be a JSON object.";
      }
      return null;
    } catch {
      return "This isn't valid JSON yet.";
    }
  }, [text]);

  const triggerLabel = getTrigger(spec.trigger.event_type)?.label ?? spec.trigger.event_type;

  async function runTest() {
    if (running || parseError) return;
    setRunning(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/workflows/${workflowId}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dryRun: true,
            input: JSON.parse(text) as Record<string, unknown>,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        runId?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Test run started — no side effects");
      onClose();
      if (data.runId && data.runId !== "skipped") {
        router.push(`/p/${propertyId}/workflows/${workflowId}/runs/${data.runId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FlaskConical className="size-4" aria-hidden />
          Test this workflow
        </DialogTitle>
      </DialogHeader>

        <p className="text-[13px] text-muted-foreground">
          Runs every step with this pretend “{triggerLabel}” data. Nothing real
          happens — no messages are sent and nothing is created — and the test
          doesn’t count toward workflow stats.
        </p>

        {dirty ? (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[12px] text-amber-700 dark:text-amber-300">
            You have unsaved edits — the test runs the last saved version.
          </p>
        ) : null}

        <label htmlFor="test-run-payload" className="text-[12px] font-medium text-foreground">
          Trigger data (editable)
        </label>
        <textarea
          id="test-run-payload"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          aria-invalid={parseError !== null}
          aria-describedby={parseError ? "test-run-payload-error" : undefined}
          className="w-full resize-y rounded-md border border-border bg-muted/30 p-2.5 font-mono text-[12px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {parseError ? (
          <p id="test-run-payload-error" className="text-[12px] text-destructive">
            {parseError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-[12px] hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={running || parseError !== null}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <FlaskConical className="size-3" aria-hidden />
            )}
            Run test
          </button>
        </div>
    </>
  );
}
