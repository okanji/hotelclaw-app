"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Node as RfNodeType,
  type Edge as RfEdgeType,
  type IsValidConnection,
} from "@xyflow/react";
import { LayoutGrid, Maximize, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShellSection } from "@/components/shell/shell-section-context";
import { Canvas } from "@/components/ai-elements/canvas";
import { Controls } from "@/components/ai-elements/controls";
import { Panel } from "@/components/ai-elements/panel";
import { Connection as ConnectionLine } from "@/components/ai-elements/connection";
import { Edge as AiEdges } from "@/components/ai-elements/edge";
import { AiCopilot } from "@/components/workflows/builder/ai-copilot";
import type { WorkflowSpec, StepNode, StepType } from "@/lib/workflows/spec";
import {
  TRIGGER_NODE_ID,
  applyPositionsToSpec,
  connect,
  disconnect,
  nextStepId,
  removeStep,
  specToGraph,
  type RFEdge,
  type RFNode,
} from "@/lib/workflows/graph";
import { getStep, getTrigger, STEPS } from "@/lib/workflows/catalog";
import { WfNode, WfNodeProvider } from "./wf-node";
import { NodePalette } from "./node-palette";
import { NodeInspector } from "./node-inspector";

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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Apply changes locally (xyflow uses these for transient updates), but we
      // only persist `position` deltas back to the spec on dragstop, below.
      // We still need this for selection/dimensions/etc to feel responsive.
      const next = applyNodeChanges(changes, displayNodes as RfNodeType[]);
      // Detect removals
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
      let nextSpec = spec;
      for (const id of removed) {
        if (id !== TRIGGER_NODE_ID) nextSpec = removeStep(nextSpec, id);
      }
      // Position drag commits — only when an interaction completes (dragging=false)
      const dragCommits: Record<string, { x: number; y: number }> = {};
      for (const change of changes) {
        if (change.type === "position" && change.dragging === false && change.position) {
          dragCommits[change.id] = change.position;
        }
      }
      if (Object.keys(dragCommits).length > 0) {
        nextSpec = applyPositionsToSpec(nextSpec, dragCommits);
      }
      if (nextSpec !== spec) setSpec(nextSpec);
      // We rely on the next render to repaint with the new spec; no local state needed.
      void next;
    },
    [displayNodes, spec, setSpec],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      let nextSpec = spec;
      for (const change of changes) {
        if (change.type === "remove") nextSpec = disconnect(nextSpec, change.id);
      }
      if (nextSpec !== spec) setSpec(nextSpec);
    },
    [spec, setSpec],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      const nextSpec = connect(spec, c.source, c.sourceHandle ?? undefined, c.target);
      setSpec(nextSpec);
    },
    [spec, setSpec],
  );

  // Reject self-loops and connections targeting the trigger.
  const isValidConnection: IsValidConnection = useCallback((c) => {
    if (!c.source || !c.target) return false;
    if (c.source === c.target) return false;
    if (c.target === TRIGGER_NODE_ID) return false;
    return true;
  }, []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, n: { id: string }) => setSelectedNodeId(n.id),
    [setSelectedNodeId],
  );

  const onEdgeDoubleClick = useCallback(
    (_: React.MouseEvent, e: { id: string }) => {
      setSpec(disconnect(spec, e.id));
    },
    [spec, setSpec],
  );

  // ─── Add-step: click in palette or drop on canvas ────────────────────────

  const addStepAt = useCallback(
    (type: StepType, position: { x: number; y: number }) => {
      const id = nextStepId(spec, type);
      const meta = getStep(type);
      // Use the catalog entry's outputSchema-implied defaults — for v1, just an
      // empty config object. The inspector lets the user fill it in.
      const newStep = { id, type, config: {} } as unknown as StepNode;

      const nextSteps = { ...spec.steps, [id]: newStep };
      const nextLayout = { ...(spec.layout ?? {}), [id]: position };
      const nextEntry = spec.entry_step_id || id;
      setSpec({
        ...spec,
        steps: nextSteps,
        layout: nextLayout,
        entry_step_id: nextEntry,
      });
      setSelectedNodeId(id);
      void meta;
    },
    [spec, setSpec, setSelectedNodeId],
  );

  const onPaletteClick = useCallback(
    (type: StepType) => {
      // Drop new node near the viewport center.
      const viewport = rf.getViewport();
      const center = {
        x: -viewport.x / viewport.zoom + 200,
        y: -viewport.y / viewport.zoom + 80,
      };
      addStepAt(type, center);
    },
    [rf, addStepAt],
  );

  const onPaletteDragStart = useCallback((type: StepType, e: React.DragEvent) => {
    e.dataTransfer.setData("application/x-wf-step-type", type);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/x-wf-step-type") as StepType;
      if (!type || !STEPS.find((s) => s.id === type)) return;
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const position = rf.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });
      addStepAt(type, position);
    },
    [rf, addStepAt],
  );

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // ─── Inspector handlers passed through node context ──────────────────────

  const ctx = useMemo(
    () => ({
      branchHandlesByType: BRANCH_HANDLES,
      onEdit: setSelectedNodeId,
      onDelete: (id: string) => setSpec(removeStep(spec, id)),
    }),
    [spec, setSpec, setSelectedNodeId],
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
      onDrop={onCanvasDrop}
      onDragOver={onCanvasDragOver}
    >
      <WfNodeProvider value={ctx}>
        <Canvas
          nodes={displayNodes as unknown as RfNodeType[]}
          edges={edges as unknown as RfEdgeType[]}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          connectionLineComponent={ConnectionLine}
          isValidConnection={isValidConnection}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onPaneClick={() => setSelectedNodeId(null)}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={1.8}
        >
          <NodePalette onAddStep={onPaletteClick} onDragStart={onPaletteDragStart} />

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

          {/* Empty state — Panel pinned to the center until the user adds a step */}
          {!hasSteps && (
            <Panel position="top-center" className="mt-24 max-w-md p-6 text-center">
              <Sparkles className="mx-auto mb-2 size-5 text-primary" aria-hidden />
              <p className="text-[13px] font-medium text-foreground">
                Build this workflow visually
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Drag a step from the palette on the left, or describe what you
                want below — the AI will scaffold it for you.
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
      />
    </div>
  );
}
