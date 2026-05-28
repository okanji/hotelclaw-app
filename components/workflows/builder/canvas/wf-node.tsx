"use client";

import { createContext, useContext } from "react";
import { Position, Handle, type NodeProps, type Node } from "@xyflow/react";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Node as AiNode,
  NodeHeader,
  NodeTitle,
  NodeDescription,
  NodeContent,
  NodeAction,
} from "@/components/ai-elements/node";
import { Toolbar } from "@/components/ai-elements/toolbar";
import { SurfaceBadge, surfaceMeta } from "@/components/workflows/builder/surface-badge";
import type { Surface } from "@/lib/workflows/catalog/types";
import type { GraphNodeData } from "@/lib/workflows/graph";
import { TRIGGER_NODE_ID } from "@/lib/workflows/graph";

export type WfRfNode = Node<GraphNodeData, "wf">;

interface ExtraHandleSpec {
  id: string;
  label: string;
  /** Tailwind color class for the handle, e.g. "bg-primary". */
  tone?: string;
}

export interface WfNodeContextValue {
  /** Extra source handles per step type (e.g. branch labels). */
  branchHandlesByType: Record<string, ExtraHandleSpec[]>;
  onEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

const WfNodeCtx = createContext<WfNodeContextValue | null>(null);

export const WfNodeProvider = WfNodeCtx.Provider;

// Layout
//   The node renders the AiNode card + a vertical strip of output rows
//   below it. Each row is `position: relative` and contains a labelled
//   slot + an xyflow `Handle` with `position={Position.Right}`. xyflow's
//   default CSS centers a Position.Right handle at the row's right edge,
//   so we get pixel-perfect alignment with the row label without computing
//   any Y offsets ourselves. (An earlier revision tried to render handles
//   at the node root with manual `style.top` math — they drifted out of
//   sync whenever the card content height changed.)
//
//   The Handle IS the visible dot — no separate decorative span — so a
//   single tap target maps to a single visual marker.

const NODE_W = 280;
const ROW_PX = 22;

function outputsFor(
  isTrigger: boolean,
  branchHandles: ExtraHandleSpec[],
): ExtraHandleSpec[] {
  if (isTrigger) {
    return [{ id: "next", label: "Next", tone: "bg-primary" }];
  }
  if (branchHandles.length === 0) {
    return [
      { id: "next", label: "Next", tone: "bg-primary" },
      { id: "error", label: "On error", tone: "bg-destructive" },
    ];
  }
  return [
    ...branchHandles,
    { id: "error", label: "On error", tone: "bg-destructive" },
  ];
}

export function WfNode({ id, data, selected }: NodeProps<WfRfNode>) {
  const ctx = useContext(WfNodeCtx);
  const isTrigger = data.kind === "trigger";
  const meta = surfaceMeta(data.surface as Surface);
  const branchHandles = ctx?.branchHandlesByType[data.typeId] ?? [];
  const outputs = outputsFor(isTrigger, branchHandles);

  return (
    <div className="relative" style={{ width: NODE_W }}>
      {/* Target handle — left center of the whole node */}
      {!isTrigger && (
        <Handle
          id="in"
          type="target"
          position={Position.Left}
          className="!size-3 !border-2 !border-background !bg-muted-foreground"
        />
      )}

      <AiNode
        handles={{ target: false, source: false }}
        className={cn(
          "w-full transition-all",
          selected && "ring-2 ring-primary",
          data.unaccepted && "ring-2 ring-[var(--chart-2)]/70",
          isTrigger && "border-l-2 border-l-primary",
        )}
      >
        <NodeHeader className="flex items-center gap-2">
          <SurfaceBadge surface={data.surface as Surface} />
          <div className="min-w-0 flex-1">
            <NodeTitle className="truncate text-[13px] leading-tight">
              {data.label}
            </NodeTitle>
            <NodeDescription className="truncate font-mono text-[10.5px]">
              {isTrigger ? "Trigger" : data.typeId}
            </NodeDescription>
          </div>
          <NodeAction>
            <span
              aria-hidden
              className="rounded-sm bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {meta.label}
            </span>
          </NodeAction>
        </NodeHeader>
        <NodeContent>
          <p className="line-clamp-3 text-[12px] text-muted-foreground">
            {data.summary || (isTrigger ? "Configure a trigger…" : "Configure this step…")}
          </p>
        </NodeContent>
      </AiNode>

      {/* Output rows. Each row is the parent positioning context for its own
       * Handle, which xyflow places at the row's right edge automatically. */}
      <ul
        role="list"
        className="mt-2 flex flex-col overflow-hidden rounded-md border border-border/60 bg-card/40 text-[11px]"
      >
        {outputs.map((out) => (
          <li
            key={out.id}
            className="relative flex items-center justify-between border-b border-border/40 px-3 last:border-b-0"
            style={{ height: ROW_PX }}
          >
            <span className="truncate text-muted-foreground">{out.label}</span>
            <Handle
              id={out.id}
              type="source"
              position={Position.Right}
              className={cn(
                "!size-3 !border-2 !border-background",
                out.id === "error" && "!bg-destructive",
                out.id === "next" && "!bg-primary",
                out.id.startsWith("branch:") && "!bg-muted-foreground",
              )}
            />
          </li>
        ))}
      </ul>

      {/* Edit / delete toolbar — visible while node is selected. */}
      {ctx && (
        <Toolbar isVisible={selected || undefined}>
          <button
            type="button"
            onClick={() => ctx.onEdit(id)}
            className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label={isTrigger ? "Edit trigger" : "Edit step"}
          >
            <Pencil className="size-3.5" />
          </button>
          {!isTrigger && (
            <button
              type="button"
              onClick={() => ctx.onDelete(id)}
              className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete step"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </Toolbar>
      )}
    </div>
  );
}
