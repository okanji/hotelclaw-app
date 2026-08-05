"use client";

import { Fragment, useMemo } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkflowSpec, type StepNode } from "@/lib/workflows/spec";
import { getStep, getTrigger } from "@/lib/workflows/catalog";
import { SurfaceBadge } from "@/components/workflows/builder/surface-badge";

/**
 * Read-only rendering of a WorkflowSpec as a vertical flow — trigger card,
 * connector rail, then steps in execution order with their catalog explain()
 * summaries. Branch arms are indented under a labelled connector ("if yes",
 * "case: urgent", …). Used to preview a template before forking it; no
 * editing affordances on purpose.
 */
export function WorkflowSpecPreview({
  spec: rawSpec,
  className,
}: {
  spec: unknown;
  className?: string;
}) {
  const parsed = useMemo(() => WorkflowSpec.safeParse(rawSpec), [rawSpec]);

  const rows = useMemo(() => {
    if (!parsed.success) return [];
    return flattenSpec(parsed.data);
  }, [parsed]);

  if (!parsed.success) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        This template’s definition couldn’t be read.
      </p>
    );
  }
  const spec = parsed.data;
  const trigger = getTrigger(spec.trigger.event_type);

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Trigger — visually distinct from action steps: violet accent + kicker. */}
      <div className="flex items-start gap-3 rounded-card bg-muted p-3">
        <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-pill-violet text-pill-violet-ink">
          <Zap className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-faint-foreground">
            When
          </p>
          <p className="text-sm font-medium text-foreground">
            {trigger?.label ?? spec.trigger.event_type}
          </p>
          {trigger?.explain(spec.trigger.filter) ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {trigger.explain(spec.trigger.filter)}
            </p>
          ) : null}
        </div>
      </div>

      {rows.map(({ step, depth, edgeLabel }, i) => {
        const entry = getStep(step.type);
        const summary = entry?.explain(step.config) ?? "";
        return (
          <Fragment key={step.id}>
            <Connector depth={depth} label={edgeLabel} />
            <div
              className="flex items-start gap-3 rounded-card bg-muted p-3"
              style={{ marginLeft: depth * 20 }}
            >
              <span className="mt-0.5 shrink-0">
                <SurfaceBadge surface={entry?.surface ?? "system"} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {step.label || entry?.label || step.type}
                </p>
                {summary ? (
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {summary}
                  </p>
                ) : null}
              </div>
              <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground/60 tabular-nums">
                {i + 1}
              </span>
            </div>
          </Fragment>
        );
      })}

      {rows.length === 0 ? (
        <>
          <Connector depth={0} label={null} />
          <div className="rounded-card p-3 text-sm text-muted-foreground shadow-ring">
            No steps yet.
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The short vertical rail between cards. Branch arms get their label as a
 * chip riding the rail ("if yes", "otherwise") so the fork reads at a glance.
 */
function Connector({ depth, label }: { depth: number; label: string | null }) {
  return (
    <div
      className="flex h-5 items-center gap-1.5"
      style={{ marginLeft: depth * 20 + 14 }}
      aria-hidden={label ? undefined : true}
    >
      <span className="h-full w-px bg-border" />
      {label ? (
        <span className="rounded-md bg-muted px-1.5 py-px text-xs font-medium text-muted-foreground">
          {label}
        </span>
      ) : null}
    </div>
  );
}

type PreviewRow = { step: StepNode; depth: number; edgeLabel: string | null };

/** Branch label → friendly chip text. */
function friendlyBranchLabel(key: string): string {
  if (key === "true") return "if yes";
  if (key === "false") return "if no";
  if (key === "_default") return "otherwise";
  return `case: ${key}`;
}

/**
 * DFS pre-order from entry_step_id so branch chains read top-to-bottom under
 * their branch point. Steps unreachable from the entry are appended at the
 * end (they'd be orphan-flagged in the builder, but a preview shouldn't hide
 * them).
 */
function flattenSpec(spec: WorkflowSpec): PreviewRow[] {
  const rows: PreviewRow[] = [];
  const visited = new Set<string>();

  function visit(id: string | undefined, depth: number, edgeLabel: string | null) {
    if (!id || visited.has(id)) return;
    const step = spec.steps[id] as StepNode | undefined;
    if (!step) return;
    visited.add(id);
    rows.push({ step, depth, edgeLabel });

    const branches = (step as { branches?: Record<string, string> }).branches;
    if (branches) {
      for (const [key, target] of Object.entries(branches)) {
        visit(target, depth + 1, friendlyBranchLabel(key));
      }
    }
    visit((step as { next?: string }).next, depth, null);
  }

  visit(spec.entry_step_id, 0, null);
  for (const id of Object.keys(spec.steps)) visit(id, 0, null);
  return rows;
}
