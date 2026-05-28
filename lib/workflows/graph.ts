// Pure conversion between WorkflowSpec and a node/edge graph the canvas
// builder renders with @xyflow/react. Kept dependency-free so it can be
// unit-tested without spinning up React.
//
// Shape
//   • Node ids: `__trigger__` for the trigger header, otherwise the step id.
//   • Edge ids encode source → label → target so we can find and remove a
//     specific branch without touching the others.
//   • Node positions come from `spec.layout` when present; missing nodes are
//     auto-laid out via BFS columns from `entry_step_id`.
//
// Helpers (`connect`, `disconnect`, `addStep`, `removeStep`,
// `applyPositionsToSpec`) are minimal CRUD over the spec — the canvas calls
// them in response to user gestures, then re-derives the graph.

import type { WorkflowSpec, StepNode } from "./spec";

export const TRIGGER_NODE_ID = "__trigger__";

export type GraphNodeKind = "trigger" | "step";

// xyflow's Node generic constrains `data` to Record<string, unknown>, so we
// model GraphNodeData as a type alias with an index signature rather than an
// interface (interfaces don't satisfy index-signature constraints).
export type GraphNodeData = {
  kind: GraphNodeKind;
  /** For step nodes, the underlying StepNode["type"]. For the trigger, the event_type. */
  typeId: string;
  /** Human label from the catalog. */
  label: string;
  /** One-line summary produced by catalog.explain(). */
  summary: string;
  /** Surface key used to colorize the node. */
  surface: string;
  /** AI-added but not yet accepted — gets the green outline. */
  unaccepted?: boolean;
  [key: string]: unknown;
};

export interface GraphEdgeMeta {
  /** "next" for linear, "branch:<label>" for branch links, "error" for on_error branches. */
  kind: "next" | "branch" | "error" | "entry";
  /** For branch edges, the branch label ("true", "false", or arbitrary switch value). */
  branchLabel?: string;
}

export interface RFNode {
  id: string;
  type: "wf";
  position: { x: number; y: number };
  data: GraphNodeData;
  selected?: boolean;
}

export interface RFEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type: "wfAnimated" | "wfTemporary";
  label?: string;
  data: GraphEdgeMeta;
}

// ─── Layout ─────────────────────────────────────────────────────────────────

const NODE_W = 320;
const NODE_H = 140;
const COL_GAP = 96;
const ROW_GAP = 32;

function autoLayout(spec: WorkflowSpec): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(TRIGGER_NODE_ID, { x: 0, y: 0 });

  // BFS from entry_step_id; record depth (column) and order-within-depth (row).
  const depths = new Map<string, number>();
  const placedAtDepth = new Map<number, number>();
  const queue: Array<{ id: string; depth: number }> = [];
  if (spec.entry_step_id) queue.push({ id: spec.entry_step_id, depth: 1 });
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    depths.set(id, depth);

    const step = spec.steps[id];
    if (!step) continue;

    const nextId = (step as { next?: string }).next;
    if (nextId) queue.push({ id: nextId, depth: depth + 1 });

    if ("branches" in step && step.branches) {
      for (const target of Object.values(step.branches as Record<string, string>)) {
        queue.push({ id: target, depth: depth + 1 });
      }
    }

    // Foreach / parallel branch starts
    if (step.type === "control.foreach") {
      queue.push({ id: step.config.body_start, depth: depth + 1 });
    }
    if (step.type === "control.parallel") {
      for (const branchStart of step.config.branches) {
        queue.push({ id: branchStart, depth: depth + 1 });
      }
    }
  }

  // Catch orphaned steps not reachable from entry — append after the deepest column.
  const maxDepth = Math.max(0, ...depths.values());
  for (const id of Object.keys(spec.steps)) {
    if (depths.has(id)) continue;
    depths.set(id, maxDepth + 1);
  }

  for (const [id, depth] of depths.entries()) {
    const row = placedAtDepth.get(depth) ?? 0;
    placedAtDepth.set(depth, row + 1);
    positions.set(id, {
      x: depth * (NODE_W + COL_GAP),
      y: row * (NODE_H + ROW_GAP),
    });
  }

  return positions;
}

function resolvePositions(spec: WorkflowSpec): Map<string, { x: number; y: number }> {
  const auto = autoLayout(spec);
  if (!spec.layout) return auto;
  // Saved positions win; auto-layout fills the gaps for newly-added nodes.
  for (const [id, pos] of Object.entries(spec.layout)) {
    auto.set(id, pos);
  }
  return auto;
}

// ─── spec → graph ───────────────────────────────────────────────────────────

export function specToGraph(
  spec: WorkflowSpec,
  opts: {
    unaccepted?: Set<string>;
    triggerLabel: string;
    triggerSummary: string;
    triggerSurface: string;
    stepMeta: (step: StepNode) => { label: string; summary: string; surface: string };
  },
): { nodes: RFNode[]; edges: RFEdge[] } {
  const positions = resolvePositions(spec);
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];

  // Trigger node
  nodes.push({
    id: TRIGGER_NODE_ID,
    type: "wf",
    position: positions.get(TRIGGER_NODE_ID) ?? { x: 0, y: 0 },
    data: {
      kind: "trigger",
      typeId: spec.trigger.event_type,
      label: opts.triggerLabel,
      summary: opts.triggerSummary,
      surface: opts.triggerSurface,
    },
  });

  // Step nodes
  for (const [id, step] of Object.entries(spec.steps)) {
    const meta = opts.stepMeta(step);
    nodes.push({
      id,
      type: "wf",
      position: positions.get(id) ?? { x: 0, y: 0 },
      data: {
        kind: "step",
        typeId: step.type,
        label: meta.label,
        summary: meta.summary,
        surface: meta.surface,
        unaccepted: opts.unaccepted?.has(id),
      },
    });
  }

  // Entry edge: trigger → entry step
  if (spec.entry_step_id) {
    edges.push({
      id: `${TRIGGER_NODE_ID}->${spec.entry_step_id}`,
      source: TRIGGER_NODE_ID,
      sourceHandle: "next",
      target: spec.entry_step_id,
      targetHandle: "in",
      type: "wfAnimated",
      data: { kind: "entry" },
    });
  }

  // Step edges
  for (const [id, step] of Object.entries(spec.steps)) {
    const nextId = (step as { next?: string }).next;
    if (nextId && spec.steps[nextId]) {
      edges.push({
        id: `${id}--next->${nextId}`,
        source: id,
        sourceHandle: "next",
        target: nextId,
        targetHandle: "in",
        type: "wfAnimated",
        data: { kind: "next" },
      });
    }
    if ("branches" in step && step.branches) {
      for (const [label, target] of Object.entries(step.branches as Record<string, string>)) {
        if (!spec.steps[target]) continue;
        edges.push({
          id: `${id}--branch:${label}->${target}`,
          source: id,
          sourceHandle: `branch:${label}`,
          target,
          targetHandle: "in",
          type: "wfAnimated",
          label,
          data: { kind: "branch", branchLabel: label },
        });
      }
    }
    // on_error: "branch:<targetStepId>" — render as a dashed/temporary edge
    const onError = (step as { on_error?: string }).on_error;
    if (typeof onError === "string" && onError.startsWith("branch:")) {
      const target = onError.slice("branch:".length);
      if (spec.steps[target]) {
        edges.push({
          id: `${id}--error->${target}`,
          source: id,
          sourceHandle: "error",
          target,
          targetHandle: "in",
          type: "wfTemporary",
          label: "on error",
          data: { kind: "error" },
        });
      }
    }
  }

  return { nodes, edges };
}

// ─── Mutations (canvas gestures → new spec) ─────────────────────────────────

export function applyPositionsToSpec(
  spec: WorkflowSpec,
  positions: Record<string, { x: number; y: number }>,
): WorkflowSpec {
  return { ...spec, layout: { ...(spec.layout ?? {}), ...positions } };
}

/** Connect: route a new edge from source's handle to target. */
export function connect(
  spec: WorkflowSpec,
  source: string,
  sourceHandle: string | undefined,
  target: string,
): WorkflowSpec {
  if (source === TRIGGER_NODE_ID) {
    return { ...spec, entry_step_id: target };
  }
  const step = spec.steps[source];
  if (!step) return spec;
  const handle = sourceHandle ?? "next";

  if (handle === "next") {
    return {
      ...spec,
      steps: { ...spec.steps, [source]: { ...step, next: target } as StepNode },
    };
  }
  if (handle === "error") {
    return {
      ...spec,
      steps: { ...spec.steps, [source]: { ...step, on_error: `branch:${target}` } as StepNode },
    };
  }
  if (handle.startsWith("branch:") && "branches" in step) {
    const label = handle.slice("branch:".length);
    const branches = { ...(step.branches as Record<string, string>), [label]: target };
    return {
      ...spec,
      steps: { ...spec.steps, [source]: { ...step, branches } as StepNode },
    };
  }
  return spec;
}

/** Disconnect: remove a specific edge. */
export function disconnect(spec: WorkflowSpec, edgeId: string): WorkflowSpec {
  // Parse "source--<kind|branch:label>->target"
  const m = edgeId.match(/^(.+?)--(.+?)->(.+)$/);
  if (!m) return spec;
  const [, source, kind, _target] = m;
  if (source === TRIGGER_NODE_ID) {
    return { ...spec, entry_step_id: "" };
  }
  const step = spec.steps[source];
  if (!step) return spec;

  if (kind === "next") {
    const { next: _drop, ...rest } = step as unknown as Record<string, unknown>;
    return {
      ...spec,
      steps: { ...spec.steps, [source]: rest as unknown as StepNode },
    };
  }
  if (kind === "error") {
    const { on_error: _drop, ...rest } = step as unknown as Record<string, unknown>;
    return {
      ...spec,
      steps: { ...spec.steps, [source]: rest as unknown as StepNode },
    };
  }
  if (kind.startsWith("branch:") && "branches" in step) {
    const label = kind.slice("branch:".length);
    const branches = { ...(step.branches as Record<string, string>) };
    delete branches[label];
    return {
      ...spec,
      steps: { ...spec.steps, [source]: { ...step, branches } as StepNode },
    };
  }
  return spec;
}

/** Remove a step + every edge that referenced it. */
export function removeStep(spec: WorkflowSpec, stepId: string): WorkflowSpec {
  if (stepId === TRIGGER_NODE_ID) return spec;
  const { [stepId]: _drop, ...steps } = spec.steps;

  // Sweep references in remaining steps
  const cleaned: Record<string, StepNode> = {};
  for (const [id, step] of Object.entries(steps)) {
    let next = (step as { next?: string }).next;
    if (next === stepId) next = undefined;

    let branches = (step as { branches?: Record<string, string> }).branches;
    if (branches) {
      branches = Object.fromEntries(
        Object.entries(branches).filter(([, t]) => t !== stepId),
      );
    }

    let onError = (step as { on_error?: string }).on_error;
    if (onError === `branch:${stepId}`) onError = undefined;

    cleaned[id] = {
      ...(step as object),
      next,
      ...(branches !== undefined ? { branches } : {}),
      on_error: onError,
    } as StepNode;
  }

  const layout = spec.layout ? { ...spec.layout } : undefined;
  if (layout) delete layout[stepId];

  return {
    ...spec,
    steps: cleaned,
    layout,
    entry_step_id: spec.entry_step_id === stepId ? "" : spec.entry_step_id,
  };
}

/** Suggest a unique step id for a new step of a given type. */
export function nextStepId(spec: WorkflowSpec, typeId: string): string {
  const base = typeId.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  let i = 1;
  let id = `${base}_${i}`;
  while (spec.steps[id]) {
    i += 1;
    id = `${base}_${i}`;
  }
  return id;
}
