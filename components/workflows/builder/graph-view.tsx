"use client";

import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowSpec, StepNode } from "@/lib/workflows/spec";
import { getStep, getTrigger } from "@/lib/workflows/catalog";
import { SurfaceBadge, surfaceMeta } from "./surface-badge";
import type { Surface } from "@/lib/workflows/catalog/types";

// Read-only graph rendering of a WorkflowSpec. Auto-laid out via a simple
// BFS from entry_step_id; deterministic enough for the v1 use case (most
// workflows have <12 nodes). Click a node → calls onSelect with the step id.

type GraphNodeData = {
  label: string;
  summary: string;
  surface: Surface;
  unaccepted?: boolean;
};

export function WorkflowGraphView({
  spec,
  unacceptedIds,
  selectedStepId,
  onSelectStep,
}: {
  spec: WorkflowSpec;
  unacceptedIds?: Set<string>;
  selectedStepId?: string;
  onSelectStep?: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => buildGraph(spec, unacceptedIds), [spec, unacceptedIds]);

  return (
    <div className="h-[600px] w-full rounded-lg border border-border/60 bg-card">
      <ReactFlow
        nodes={nodes.map((n) => ({
          ...n,
          selected: n.id === selectedStepId,
        }))}
        edges={edges}
        nodeTypes={NODE_TYPES}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        onNodeClick={(_e, n) => onSelectStep?.(n.id)}
      >
        <Background gap={16} size={1} className="opacity-40" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

// ─── Layout ─────────────────────────────────────────────────────────────────

const NODE_W = 240;
const NODE_H = 64;
const COL_GAP = 80;
const ROW_GAP = 24;

function buildGraph(
  spec: WorkflowSpec,
  unaccepted?: Set<string>,
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const nodes: Node<GraphNodeData>[] = [];
  const edges: Edge[] = [];

  // Trigger node — anchored at column 0.
  const trigger = getTrigger(spec.trigger.event_type);
  nodes.push({
    id: "__trigger__",
    type: "wfNode",
    position: { x: 0, y: 0 },
    data: {
      label: trigger?.label ?? spec.trigger.event_type,
      summary: trigger?.explain(spec.trigger.filter?.expr) ?? "",
      surface: trigger?.surface ?? "system",
    },
  });

  // BFS over steps assigning column (depth) and row (sibling index).
  const depths = new Map<string, number>();
  const rowsByDepth = new Map<number, number>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: spec.entry_step_id, depth: 1 },
  ];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    depths.set(id, depth);
    const row = rowsByDepth.get(depth) ?? 0;
    rowsByDepth.set(depth, row + 1);

    const step = spec.steps[id];
    if (!step) continue;

    // enqueue successors
    if ((step as { next?: string }).next) {
      queue.push({ id: (step as { next?: string }).next!, depth: depth + 1 });
    }
    if ("branches" in step && step.branches) {
      for (const target of Object.values(step.branches as Record<string, string>)) {
        queue.push({ id: target, depth: depth + 1 });
      }
    }
  }

  // Place each step at (depth * (NODE_W + COL_GAP), row * (NODE_H + ROW_GAP))
  const placedRows = new Map<number, number>();
  for (const [id, depth] of depths.entries()) {
    const row = placedRows.get(depth) ?? 0;
    placedRows.set(depth, row + 1);
    const step = spec.steps[id] as StepNode | undefined;
    if (!step) continue;
    const entry = getStep(step.type);
    nodes.push({
      id,
      type: "wfNode",
      position: {
        x: depth * (NODE_W + COL_GAP),
        y: row * (NODE_H + ROW_GAP),
      },
      data: {
        label: entry?.label ?? step.type,
        summary: entry?.explain(step.config) ?? step.id,
        surface: entry?.surface ?? "system",
        unaccepted: unaccepted?.has(id),
      },
    });
  }

  // Edge: trigger → entry step
  edges.push({
    id: `__trigger__->${spec.entry_step_id}`,
    source: "__trigger__",
    target: spec.entry_step_id,
    type: "smoothstep",
  });

  // Edges between steps (next + branches)
  for (const [id, step] of Object.entries(spec.steps)) {
    if ((step as { next?: string }).next) {
      const target = (step as { next?: string }).next!;
      edges.push({
        id: `${id}->${target}`,
        source: id,
        target,
        type: "smoothstep",
      });
    }
    if ("branches" in step && step.branches) {
      for (const [label, target] of Object.entries(step.branches as Record<string, string>)) {
        edges.push({
          id: `${id}-${label}->${target}`,
          source: id,
          target,
          label,
          type: "smoothstep",
          labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
        });
      }
    }
  }

  return { nodes, edges };
}

// ─── Custom node ────────────────────────────────────────────────────────────

function WorkflowFlowNode({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  const meta = surfaceMeta(data.surface);
  return (
    <div
      className={
        "flex w-[240px] items-start gap-2 rounded-md border bg-card px-3 py-2 text-[12px] transition-colors " +
        (selected
          ? "border-primary shadow-sm"
          : data.unaccepted
            ? "border-l-2 border-l-[var(--chart-2)] border-border/60"
            : "border-border/60")
      }
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/30" />
      <SurfaceBadge surface={data.surface} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{data.label}</div>
        <div className="truncate text-[11px] text-muted-foreground">{data.summary}</div>
      </div>
      <span className="sr-only">{meta.label}</span>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/30" />
    </div>
  );
}

const NODE_TYPES = { wfNode: WorkflowFlowNode };
