import { getStep } from "@/lib/workflows/catalog";
import type { StepNode, WorkflowSpec } from "@/lib/workflows/spec";

export type BranchPathKey = "true" | "false";

export interface BranchPathInfo {
  key: BranchPathKey;
  targetStepId: string | undefined;
  /** Lane has no real steps yet — only a bare End node (or nothing). */
  isEmpty: boolean;
  /** First step on the path, when not empty. */
  headStepId: string | undefined;
  /** Short label for the path preview chip. */
  preview: string;
  /** How many non-end steps are on this path. */
  stepCount: number;
}

function isBareEnd(step: StepNode | undefined): boolean {
  return (
    !!step &&
    step.type === "control.end" &&
    !(step as { config?: { outcome?: string } }).config?.outcome
  );
}

function walkPath(spec: WorkflowSpec, startId: string | undefined): StepNode[] {
  if (!startId) return [];
  const chain: StepNode[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = startId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const step: StepNode | undefined = spec.steps[cursor];
    if (!step) break;
    chain.push(step);
    if ("branches" in step) break;
    cursor = (step as { next?: string }).next;
  }
  return chain;
}

function stepLabel(step: StepNode): string {
  const meta = getStep(step.type);
  return step.label || meta?.label || step.type;
}

function describePath(steps: StepNode[]): { preview: string; stepCount: number; headStepId?: string } {
  const actionable = steps.filter((s) => s.type !== "control.end");
  if (actionable.length === 0) {
    return { preview: "No steps yet — click to add", stepCount: 0 };
  }
  const head = actionable[0]!;
  if (actionable.length === 1) {
    return { preview: stepLabel(head), stepCount: 1, headStepId: head.id };
  }
  return {
    preview: `${stepLabel(head)} + ${actionable.length - 1} more`,
    stepCount: actionable.length,
    headStepId: head.id,
  };
}

export interface StepBranchContext {
  branchStepId: string;
  branchKey: BranchPathKey;
  /** "Then" | "Else" */
  pathLabel: string;
}

function stepIdsOnPath(spec: WorkflowSpec, startId: string | undefined): Set<string> {
  const ids = new Set<string>();
  let cursor = startId;
  while (cursor && !ids.has(cursor)) {
    ids.add(cursor);
    const step = spec.steps[cursor];
    if (!step) break;
    if ("branches" in step) break;
    cursor = (step as { next?: string }).next;
  }
  return ids;
}

/** When `stepId` lives on a branch lane, returns the owning branch step and lane. */
export function findStepBranchContext(
  spec: WorkflowSpec,
  stepId: string,
): StepBranchContext | null {
  for (const [branchStepId, step] of Object.entries(spec.steps)) {
    if (step.type !== "control.branch_if") continue;
    const paths = getBranchPaths(spec, branchStepId);
    for (const path of paths) {
      const onPath = stepIdsOnPath(spec, path.targetStepId);
      if (onPath.has(stepId)) {
        return {
          branchStepId,
          branchKey: path.key,
          pathLabel: path.key === "true" ? "Then" : "Else",
        };
      }
    }
  }
  return null;
}

/** Resolve true/false lane metadata for a branch step. */
export function getBranchPaths(
  spec: WorkflowSpec,
  branchStepId: string,
): BranchPathInfo[] {
  const branchStep = spec.steps[branchStepId];
  const branches =
    (branchStep as { branches?: Record<string, string> } | undefined)?.branches ?? {};

  return (["true", "false"] as const).map((key) => {
    const targetStepId = branches[key];
    const chain = walkPath(spec, targetStepId);
    const isEmpty = chain.length === 0 || (chain.length === 1 && isBareEnd(chain[0]));
    const { preview, stepCount, headStepId } = describePath(chain);

    return {
      key,
      targetStepId,
      isEmpty,
      headStepId,
      preview,
      stepCount,
    };
  });
}
