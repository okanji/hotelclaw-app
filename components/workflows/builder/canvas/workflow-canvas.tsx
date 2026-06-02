"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
  type Node as RfNodeType,
  type Edge as RfEdgeType,
} from "@xyflow/react";
import { LayoutGrid, Maximize, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShellSection } from "@/components/shell/shell-section-context";
import { Canvas } from "@/components/ai-elements/canvas";
import { Controls } from "@/components/ai-elements/controls";
import { Panel } from "@/components/ai-elements/panel";
import { Edge as AiEdges } from "@/components/ai-elements/edge";
import { AiCopilot } from "@/components/workflows/builder/ai-copilot";
import type { WorkflowSpec, StepNode } from "@/lib/workflows/spec";
import {
  applyPositionsToSpec,
  specToGraph,
  type RFNode,
} from "@/lib/workflows/graph";
import { getStep, getTrigger } from "@/lib/workflows/catalog";
import { WfNode, WfNodeProvider } from "./wf-node";
import { NodeInspector } from "./node-inspector";

// ─────────────────────────────────────────────────────────────────────────────
// The Map view is a read-only spatial OVERVIEW of the workflow. All structural
// editing (adding, deleting, and re-wiring steps) happens in the Steps view,
// which owns the correct splicing mutators. The Map historically had its own
// add/delete paths that produced orphan nodes and severed chains — those have
// been removed. What stays here: pan / zoom / fit / minimap, click-a-node to
// open the inspector and edit its config, and drag-to-reposition (layout only).
// ─────────────────────────────────────────────────────────────────────────────

const NODE_TYPES = { wf: WfNode };
const EDGE_TYPES = { wfAnimated: AiEdges.Animated, wfTemporary: AiEdges.Temporary };

const DEFAULT_EDGE_OPTIONS = {
  type: "wfAnimated" as const,
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--primary)" },
  style: { stroke: "var(--primary)", strokeWidth: 1.5 },
};

// Color by edge kind. xyflow renders each edge with the `style` we set on
// the edge object — so we override per-edge below in `specToGraph` output.
const EDGE_STROKE = {
  next: "var(--primary)",
  branch: "color-mix(in srgb, var(--muted-foreground) 60%, transparent)",
  error: "var(--destructive)",
  entry: "var(--primary)",
} as const;

// Branch handle layouts per step type. Other steps fall back to a single
// "next" source handle that AiNode renders.
const BRANCH_HANDLES: Record<string, { id: string; label: string }[]> = {
  "ai.branch_decision": [
    { id: "branch:true", label: "true" },
    { id: "branch:false", label: "false" },
  ],
  "control.branch_if": [
    { id: "branch:true", label: "true" },
    { id: "branch:false", label: "false" },
  ],
};

type WorkflowCanvasProps = {
  propertyId: string;
  spec: WorkflowSpec;
  setSpec: (next: WorkflowSpec) => void;
  unacceptedIds?: Set<string>;
  applyAiSpec: (next: WorkflowSpec) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onProposedEntityType?: (e: {
    name: string;
    display_name: string;
    schema: Record<string, unknown>;
  }) => void;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  /** Close the canvas view (returns to list). */
  onClose?: () => void;
  /** Per-workflow webhook token, forwarded to the trigger inspector. */
  webhookToken?: string | null;
};

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  propertyId,
  spec,
  setSpec,
  unacceptedIds,
  applyAiSpec,
  busy,
  setBusy,
  onProposedEntityType,
  selectedNodeId,
  setSelectedNodeId,
  onClose,
  webhookToken,
}: WorkflowCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const { setSidebarHidden } = useShellSection();

  // Claim the section-sidebar space while the canvas is mounted; release it
  // when the user switches view or navigates away.
  useEffect(() => {
    setSidebarHidden(true);
    return () => setSidebarHidden(false);
  }, [setSidebarHidden]);

  // Build the graph each render from the spec (with selected flag overlayed).
  const { nodes, edges } = useMemo(() => {
    const g = specToGraph(spec, {
      unaccepted: unacceptedIds,
      triggerLabel: getTrigger(spec.trigger.event_type)?.label ?? spec.trigger.event_type,
      triggerSummary:
        getTrigger(spec.trigger.event_type)?.explain(spec.trigger.filter?.expr) ?? "",
      triggerSurface: getTrigger(spec.trigger.event_type)?.surface ?? "system",
      stepMeta: (step: StepNode) => {
        const meta = getStep(step.type);
        return {
          label: step.label || meta?.label || step.type,
          summary: meta?.explain((step as { config?: unknown }).config) ?? "",
          surface: meta?.surface ?? "system",
        };
      },
    });
    // Style each edge by its semantic kind. xyflow respects per-edge `style`
    // + `markerEnd` overrides over `defaultEdgeOptions`.
    const styledEdges = g.edges.map((e) => {
      const stroke = EDGE_STROKE[e.data.kind];
      return {
        ...e,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        style: {
          stroke,
          strokeWidth: e.data.kind === "error" ? 1 : 1.5,
          ...(e.data.kind === "error" ? { strokeDasharray: "5 5" } : {}),
        },
        labelStyle: {
          fontSize: 10,
          fontWeight: 500,
          fill: "var(--muted-foreground)",
        },
        labelBgStyle: { fill: "var(--background)" },
        labelBgPadding: [4, 2] as [number, number],
      };
    });
    return { nodes: g.nodes, edges: styledEdges };
  }, [spec, unacceptedIds]);

  const displayNodes: RFNode[] = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [nodes, selectedNodeId],
  );

  // Read-only canvas: the only spec mutation we persist is a position drag
  // (layout, never structure). Selection/dimension changes stay transient.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, displayNodes as RfNodeType[]);
      const dragCommits: Record<string, { x: number; y: number }> = {};
      for (const change of changes) {
        if (change.type === "position" && change.dragging === false && change.position) {
          dragCommits[change.id] = change.position;
        }
      }
      if (Object.keys(dragCommits).length > 0) {
        setSpec(applyPositionsToSpec(spec, dragCommits));
      }
      // We rely on the next render to repaint from the spec; no local state.
      void next;
    },
    [displayNodes, spec, setSpec],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, n: { id: string }) => setSelectedNodeId(n.id),
    [setSelectedNodeId],
  );

  // ─── Inspector handler passed through node context ───────────────────────
  // No onDelete — deletion lives in the Steps view. The node toolbar therefore
  // shows only the Edit (open inspector) action.

  const ctx = useMemo(
    () => ({
      branchHandlesByType: BRANCH_HANDLES,
      onEdit: setSelectedNodeId,
    }),
    [setSelectedNodeId],
  );

  // ─── Toolbar actions ────────────────────────────────────────────────────

  const onAutoLayout = useCallback(() => {
    // Strip saved positions; specToGraph auto-lays out when layout is missing.
    const { layout: _drop, ...rest } = spec;
    setSpec(rest as WorkflowSpec);
    // Wait a tick for nodes to re-render at new positions, then fit.
    setTimeout(() => rf.fitView({ padding: 0.25, duration: 300 }), 50);
  }, [spec, setSpec, rf]);

  const onFitView = useCallback(() => {
    rf.fitView({ padding: 0.25, duration: 300 });
  }, [rf]);

  const hasSteps = Object.keys(spec.steps).length > 0;

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative size-full min-h-[480px] overflow-hidden rounded-lg border border-border/60 bg-sidebar",
      )}
    >
      <WfNodeProvider value={ctx}>
        <Canvas
          nodes={displayNodes as unknown as RfNodeType[]}
          edges={edges as unknown as RfEdgeType[]}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelectedNodeId(null)}
          // Read-only structure: no connecting, no edge deletion, no delete-key.
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={1.8}
        >
          {/* Top-left: read-only overview hint, so the missing palette/edit
              affordances read as intentional rather than broken. */}
          {hasSteps && (
            <Panel position="top-left" className="m-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                <Maximize className="size-3" aria-hidden />
                Overview — edit steps in the Steps view
              </span>
            </Panel>
          )}

          {/* Top-right cluster: zoom controls + layout actions + close X */}
          <Panel position="top-right" className="flex items-center gap-1 p-1">
            <button
              type="button"
              onClick={onAutoLayout}
              title="Auto-layout"
              className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <LayoutGrid className="size-3" aria-hidden /> Auto-layout
            </button>
            <button
              type="button"
              onClick={onFitView}
              title="Fit view"
              className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Maximize className="size-3" aria-hidden /> Fit
            </button>
            <span className="mx-1 h-4 w-px bg-border" />
            <Controls
              position="top-right"
              className="!static !m-0 flex-row gap-px [&>button]:size-7"
              showFitView={false}
              showInteractive={false}
            />
            {onClose && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <button
                  type="button"
                  onClick={onClose}
                  title="Close canvas"
                  aria-label="Close canvas"
                  className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </>
            )}
          </Panel>

          {/* Empty state — Panel pinned to the center until there are steps. The
              Map is a read-only overview, so it points the user at the Steps
              view (or the AI copilot below) rather than a palette. */}
          {!hasSteps && (
            <Panel position="top-center" className="mt-24 max-w-md p-6 text-center">
              <Sparkles className="mx-auto mb-2 size-5 text-primary" aria-hidden />
              <p className="text-[13px] font-medium text-foreground">
                Nothing to map yet
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Add steps in the Steps view, or describe what you want below —
                the AI will scaffold it for you. This Map is a read-only
                overview of the workflow.
              </p>
            </Panel>
          )}

          {/* MiniMap for navigation in larger workflows */}
          <MiniMap
            position="bottom-right"
            className="!m-3 !rounded-md !border !border-border/60 !bg-card"
            nodeColor={(n) => {
              const surface = (n.data as { surface?: string } | undefined)?.surface;
              if (surface === "ai") return "var(--primary)";
              if (surface === "control") return "var(--muted-foreground)";
              return "var(--chart-1)";
            }}
            nodeStrokeWidth={0}
            maskColor="color-mix(in srgb, var(--background) 60%, transparent)"
            pannable
            zoomable
          />

          {/* Bottom AI co-pilot Panel — anchored center, max-width contained */}
          <Panel position="bottom-center" className="m-3 w-full max-w-2xl">
            <AiCopilot
              propertyId={propertyId}
              currentSpec={spec}
              onSpec={applyAiSpec}
              onProposedEntityType={onProposedEntityType}
              busy={busy}
              setBusy={setBusy}
              className="border-0 bg-transparent shadow-none"
            />
          </Panel>
        </Canvas>
      </WfNodeProvider>

      <NodeInspector
        spec={spec}
        propertyId={propertyId}
        selectedNodeId={selectedNodeId}
        onClose={() => setSelectedNodeId(null)}
        onChange={setSpec}
        onStepRenamed={setSelectedNodeId}
        webhookToken={webhookToken}
      />
    </div>
  );
}
