"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckCircle2,
  ChevronRight,
  GitBranch,
  GripVertical,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SurfaceBadge } from "@/components/workflows/builder/surface-badge";
import {
  getStep,
  getTrigger,
  STEPS,
} from "@/lib/workflows/catalog";
import type { StepCatalogEntry, Surface } from "@/lib/workflows/catalog/types";
import type { StepNode, StepType, WorkflowSpec } from "@/lib/workflows/spec";
import { nextStepId, TRIGGER_NODE_ID } from "@/lib/workflows/graph";
import { NodeInspector } from "@/components/workflows/builder/canvas/node-inspector";

// Vertical, Zapier-style builder.
//
//   ● Trigger card
//   │
//   + Add step
//   │
//   ① Step card
//   │
//   + Add step
//   │
//   ② Branch ────┬──────────────┐
//                │ IF TRUE      │ IF FALSE
//                ① step          ① step
//                │               │
//                END             END
//   │
//   END
//
// Each "row" (trigger card, step card, +button, end marker) has a 36px-wide
// rail column on the left that draws its share of a continuous vertical
// line. Numbered chips sit on top with a solid background so they appear to
// punctuate the line. Branch steps fan out into labelled lanes with their
// own nested rails. Clicking any card opens the right-side inspector sheet.

interface SlotTarget {
  /** Step id whose `.next` (or branch slot) we are filling. */
  parentId: string | null;
  /** Branch label when the parent is a branch step. */
  branch?: string;
  /** Set entry_step_id instead — slot is the top of the workflow. */
  asEntry?: boolean;
}

const RAIL_W = "w-9"; // 36px column for the rail
const LINE_LEFT = "left-[17px]"; // line sits in the middle of the rail column

// Line variants — each row draws its share of the continuous rail.
const LINE_FULL = "absolute inset-y-0 w-px bg-border";
const LINE_DOWN = "absolute top-1/2 bottom-0 w-px bg-border"; // trigger/branch chips
const LINE_UP = "absolute top-0 bottom-1/2 w-px bg-border"; // end marker

export function TreeList({
  spec,
  isDurable,
  selectedStepId,
  onSelectStep,
  onChange,
  unacceptedIds,
}: {
  spec: WorkflowSpec;
  isDurable: boolean;
  selectedStepId?: string;
  onSelectStep?: (stepId: string) => void;
  onChange?: (next: WorkflowSpec) => void;
  unacceptedIds?: Set<string>;
}) {
  const [paletteAt, setPaletteAt] = useState<SlotTarget | null>(null);
  const [inspectorOpenFor, setInspectorOpenFor] = useState<string | null>(null);

  const selectStep = useCallback(
    (id: string) => {
      onSelectStep?.(id);
      setInspectorOpenFor(id);
    },
    [onSelectStep],
  );

  const insertStep = useCallback(
    (type: StepType, target: SlotTarget) => {
      if (!onChange) return;
      const id = nextStepId(spec, type);

      // Mutable working copy of the steps map — add the new step, optionally
      // seed branch lanes, then wire it into the slot below.
      const steps: Record<string, StepNode> = {
        ...spec.steps,
        [id]: { id, type, config: {} } as unknown as StepNode,
      };

      // Branch steps fan out. Seed each lane with its own bare End node so the
      // fork renders — and validates (branch targets must point at real steps)
      // — the instant it's added. Empty lanes show an "add first step" prompt.
      if (isBranchType(type)) {
        const labels =
          type === "control.branch_switch" ? ["_default"] : ["true", "false"];
        const branches: Record<string, string> = {};
        for (const label of labels) {
          const endId = freshEndId(steps);
          steps[endId] = { id: endId, type: "control.end", config: {} } as StepNode;
          branches[label] = endId;
        }
        steps[id] = { ...steps[id], branches } as StepNode;
      }

      // Thread the slot's previous occupant onto the new step's `.next` so an
      // insert in the middle of a chain keeps the tail reachable. Branch steps
      // route via their lanes, not `.next`, so we don't thread through them.
      const thread = (prev: string | undefined) => {
        if (prev && steps[prev] && !isBranchType(type)) {
          steps[id] = { ...steps[id], next: prev } as StepNode;
        }
      };

      let entry_step_id = spec.entry_step_id;
      if (target.asEntry) {
        thread(spec.entry_step_id);
        entry_step_id = id;
      } else if (target.parentId) {
        const parent = steps[target.parentId];
        if (parent) {
          if (target.branch) {
            const prev = (parent as { branches?: Record<string, string> }).branches?.[
              target.branch
            ];
            thread(prev);
            const branches = {
              ...((parent as { branches?: Record<string, string> }).branches ?? {}),
              [target.branch]: id,
            };
            steps[target.parentId] = { ...parent, branches } as StepNode;
          } else {
            thread((parent as { next?: string }).next);
            steps[target.parentId] = { ...parent, next: id } as StepNode;
          }
        }
      }

      onChange({ ...spec, steps, entry_step_id });
      setPaletteAt(null);
      setInspectorOpenFor(id);
      onSelectStep?.(id);
    },
    [spec, onChange, onSelectStep],
  );

  const deleteStep = useCallback(
    (id: string) => {
      if (!onChange) return;
      onChange(deleteStepSpliced(spec, id));
    },
    [spec, onChange],
  );

  const ordinalMap = useMemo(() => buildOrdinals(spec), [spec]);

  // Pre-compute every linear (non-branch) chain in the spec — keyed by the
  // first step id. dragEnd looks up which chain an item belongs to so it can
  // refuse cross-chain drops and rewrite the right pointers.
  const chainMap = useMemo(() => buildChainMap(spec), [spec]);

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    // 6px activation distance — keeps click-to-edit fast and drag intentional.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setDraggingId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingId(null);
      if (!onChange || !e.over || e.active.id === e.over.id) return;
      const activeId = String(e.active.id);
      const overId = String(e.over.id);
      const activeChain = chainMap.get(activeId);
      if (!activeChain) return;
      // Only allow in-chain reordering for v1.
      if (!activeChain.includes(overId)) return;

      const fromIdx = activeChain.indexOf(activeId);
      const toIdx = activeChain.indexOf(overId);
      if (fromIdx === -1 || toIdx === -1) return;

      const newOrder = arrayMove(activeChain, fromIdx, toIdx);
      const nextSpec = rewriteChainOrder(spec, activeChain, newOrder);
      onChange(nextSpec);
    },
    [chainMap, spec, onChange],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <div className="mx-auto w-full max-w-[640px]">
      <TriggerRow
        spec={spec}
        isDurable={isDurable}
        selected={selectedStepId === TRIGGER_NODE_ID}
        onEdit={() => {
          onSelectStep?.(TRIGGER_NODE_ID);
          setInspectorOpenFor(TRIGGER_NODE_ID);
        }}
      />

      <Rail
        spec={spec}
        startId={spec.entry_step_id}
        parentForInsert={{ parentId: null, asEntry: true }}
        depth={0}
        ordinalMap={ordinalMap}
        selectedStepId={selectedStepId}
        unacceptedIds={unacceptedIds}
        onClickStep={selectStep}
        onDeleteStep={deleteStep}
        onOpenPalette={setPaletteAt}
      />

      <PaletteDialog
        open={paletteAt !== null}
        onClose={() => setPaletteAt(null)}
        onPick={(type) => paletteAt && insertStep(type, paletteAt)}
      />

      <NodeInspector
        spec={spec}
        selectedNodeId={inspectorOpenFor}
        onClose={() => setInspectorOpenFor(null)}
        onChange={(next) => onChange?.(next)}
      />
      </div>
    </DndContext>
  );
}

// ─── Trigger row ────────────────────────────────────────────────────────────

function TriggerRow({
  spec,
  isDurable,
  selected,
  onEdit,
}: {
  spec: WorkflowSpec;
  isDurable: boolean;
  selected: boolean;
  onEdit: () => void;
}) {
  const trigger = getTrigger(spec.trigger.event_type);
  return (
    <div className="relative flex gap-3">
      <RailColumn lineVariant="down" chipPosition="center">
        <RailChip variant="primary">T</RailChip>
      </RailColumn>

      <button
        type="button"
        onClick={onEdit}
        className={cn(
          "group mb-1 flex flex-1 items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all",
          selected
            ? "border-primary ring-2 ring-primary/30"
            : "border-primary/30 hover:border-primary/60",
        )}
      >
        <SurfaceBadge surface={trigger?.surface ?? "system"} className="mt-0.5 !size-8" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
              When
            </span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                isDurable
                  ? "bg-muted text-muted-foreground"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
              )}
            >
              {isDurable ? "Runs durably" : "Runs instantly"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[15px] font-semibold text-foreground">
            {trigger?.label ?? spec.trigger.event_type}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">
            {trigger?.explain(spec.trigger.filter?.expr) ?? ""}
          </p>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  );
}

// ─── Recursive rail renderer ────────────────────────────────────────────────

function Rail({
  spec,
  startId,
  parentForInsert,
  depth,
  ordinalMap,
  selectedStepId,
  unacceptedIds,
  onClickStep,
  onDeleteStep,
  onOpenPalette,
}: {
  spec: WorkflowSpec;
  startId: string | undefined;
  parentForInsert: SlotTarget;
  depth: number;
  ordinalMap: Map<string, string>;
  selectedStepId?: string;
  unacceptedIds?: Set<string>;
  onClickStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
  onOpenPalette: (slot: SlotTarget) => void;
}) {
  const chain = useMemo(() => walkChain(spec, startId), [spec, startId]);

  // Empty lane fallback — shown inside a branch column when its slot is unset
  // OR when it holds only a freshly-seeded bare End (the path ends with nothing
  // on it yet). Either way we invite the user to add the first step.
  const isEmpty = chain.length === 0 || (chain.length === 1 && isBareEnd(chain[0]));
  if (isEmpty) {
    return (
      <div className="flex gap-3">
        <RailColumn lineVariant="up" chipPosition="center">
          {/* No chip — just the line going up to the parent */}
        </RailColumn>
        <div className="flex-1">
          <EmptyLane onAdd={() => onOpenPalette(parentForInsert)} />
        </div>
      </div>
    );
  }

  // Sortable portion: linear steps only. Branch steps own the chain tail (they
  // fan into lanes) and End nodes are structural terminals — neither is
  // reorderable.
  const sortableIds = chain
    .filter((s) => !isBranchStep(s) && s.type !== "control.end")
    .map((s) => s.id);

  return (
    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col">
        <InsertRow onClick={() => onOpenPalette(parentForInsert)} />

        {chain.map((step, i) => {
          const ordinal = ordinalMap.get(step.id) ?? "•";
          const isBranch = isBranchStep(step);

          // A control.end renders as the terminal marker itself (not a config
          // card), so it never doubles up with the auto End row below.
          if (step.type === "control.end") {
            return (
              <EndStepRow
                key={step.id}
                selected={selectedStepId === step.id}
                outcome={(step as { config?: { outcome?: string } }).config?.outcome}
                onClick={() => onClickStep(step.id)}
              />
            );
          }

          return (
            <Fragment key={step.id}>
              <StepRow
                step={step}
                ordinal={ordinal}
                selected={selectedStepId === step.id}
                unaccepted={unacceptedIds?.has(step.id)}
                draggable={!isBranch}
                onClick={() => onClickStep(step.id)}
                onDelete={() => onDeleteStep(step.id)}
              />

              {isBranch ? (
                <BranchLanes
                  spec={spec}
                  step={step}
                  depth={depth}
                  ordinalMap={ordinalMap}
                  selectedStepId={selectedStepId}
                  unacceptedIds={unacceptedIds}
                  onClickStep={onClickStep}
                  onDeleteStep={onDeleteStep}
                  onOpenPalette={onOpenPalette}
                />
              ) : (
                <InsertRow
                  onClick={() => onOpenPalette({ parentId: step.id })}
                />
              )}

              {/* End marker only when the last step isn't a branch or an End
               * node (those render their own terminus). */}
              {i === chain.length - 1 && !isBranch && <EndRow />}
            </Fragment>
          );
        })}
      </div>
    </SortableContext>
  );
}

// ─── Rail column + chip primitives ──────────────────────────────────────────

function RailColumn({
  children,
  lineVariant = "full",
  chipPosition = "center",
}: {
  children?: React.ReactNode;
  lineVariant?: "full" | "down" | "up";
  chipPosition?: "center" | "top";
}) {
  const lineClass =
    lineVariant === "down" ? LINE_DOWN : lineVariant === "up" ? LINE_UP : LINE_FULL;
  return (
    <div className={cn("relative flex shrink-0 flex-col items-center", RAIL_W)}>
      <span className={cn(lineClass, LINE_LEFT)} aria-hidden />
      <div
        className={cn(
          "relative z-10",
          chipPosition === "center" && "my-auto",
          chipPosition === "top" && "mt-3",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function RailChip({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "primary" | "muted" | "small";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full border shadow-sm tabular-nums",
        variant === "primary" &&
          "size-7 border-primary bg-primary text-[10px] font-bold uppercase tracking-wide text-primary-foreground",
        variant === "default" &&
          "size-7 border-border bg-background text-[11px] font-semibold text-foreground",
        variant === "muted" &&
          "size-7 border-border bg-background text-muted-foreground",
        variant === "small" &&
          "size-5 border-border bg-background text-[10px] font-medium text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

// ─── Insert row ─────────────────────────────────────────────────────────────

function InsertRow({ onClick }: { onClick: () => void }) {
  // The rail keeps its continuous vertical line on the left, but the actual
  // "+ Add step" affordance sits centered in the card column so it lands
  // right between the cards visually (Zapier-style).
  return (
    <div className="group/insert relative flex gap-3 py-1.5">
      <RailColumn lineVariant="full" chipPosition="center" />
      <div className="flex flex-1 items-center justify-center">
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-background/60 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground opacity-60 shadow-sm transition-all hover:border-primary hover:bg-background hover:text-primary hover:opacity-100 group-hover/insert:opacity-100"
          aria-label="Add step"
          title="Add step"
        >
          <Plus className="size-3" aria-hidden />
          Add step
        </button>
      </div>
    </div>
  );
}

// ─── Step row ──────────────────────────────────────────────────────────────

function StepRow({
  step,
  ordinal,
  selected,
  unaccepted,
  draggable,
  onClick,
  onDelete,
}: {
  step: StepNode;
  ordinal: string;
  selected: boolean;
  unaccepted?: boolean;
  /** Branch steps are pinned at the chain tail and not reorderable. */
  draggable: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const meta = getStep(step.type);
  const surface = (meta?.surface ?? "system") as Surface;
  const summary = meta?.explain((step as { config?: unknown }).config) ?? step.id;
  const isAi = surface === "ai";
  const isBranch = isBranchStep(step);
  const category = isBranch ? "Decision" : isAi ? "AI action" : "Action";

  const sortable = useSortable({ id: step.id, disabled: !draggable });
  // The source row stays anchored in its original slot — we suppress the
  // sortable transform on the dragging item itself so it doesn't shadow the
  // cursor. Other (non-dragging) rows keep their transforms so they shift
  // to indicate where the drop will land. A subtle lift effect on the
  // anchored source tells the user "this is what's being moved."
  const style = sortable.isDragging
    ? { transform: undefined, transition: sortable.transition }
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      };

  // The OUTER wrapper is the drag activator — anywhere on the row works as
  // a grab target. Thanks to the PointerSensor's `distance: 6` activation
  // constraint, a quick click without movement still fires the card's
  // `onClick` to open the inspector; only a real drag (>6px) starts dnd.
  const activatorProps = draggable
    ? { ...sortable.attributes, ...sortable.listeners }
    : {};

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      {...activatorProps}
      className={cn(
        "group/row relative flex gap-3 touch-none",
        draggable && "cursor-grab active:cursor-grabbing",
        sortable.isDragging && "z-10",
      )}
    >
      <RailColumn lineVariant="full" chipPosition="center">
        {/* Chip — visual only. Drag is captured at the row level. The grip
         * icon appears on row hover to advertise the affordance. */}
        <div
          aria-hidden
          className="relative inline-flex size-7 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold tabular-nums text-foreground shadow-sm"
        >
          <span
            className={cn(
              "transition-opacity",
              draggable && "group-hover/row:opacity-0",
            )}
          >
            {ordinal}
          </span>
          {draggable && (
            <GripVertical className="absolute size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100" />
          )}
        </div>
      </RailColumn>

      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "group relative mb-1 flex flex-1 items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected
            ? "border-primary ring-2 ring-primary/30"
            : "border-border/60 hover:border-foreground/30",
          unaccepted && "ring-2 ring-[var(--chart-2)]/60",
          sortable.isDragging &&
            "border-primary shadow-xl ring-2 ring-primary/40",
        )}
      >
        <SurfaceBadge surface={surface} className="mt-0.5 !size-8" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-[0.08em]",
                isBranch
                  ? "text-amber-600 dark:text-amber-400"
                  : isAi
                    ? "text-primary"
                    : "text-muted-foreground",
              )}
            >
              {category}
            </span>
            {isAi && <Sparkles className="size-3 text-primary" aria-hidden />}
            {isBranch && (
              <GitBranch className="size-3 text-amber-500" aria-hidden />
            )}
          </div>
          <p className="mt-0.5 truncate text-[14.5px] font-semibold text-foreground">
            {step.label || meta?.label || step.type}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">
            {summary}
          </p>
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Remove step"
            aria-label="Remove step"
            className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
          <ChevronRight className="size-4 text-muted-foreground/70" />
        </div>
      </div>
    </div>
  );
}

// ─── Branch lanes ───────────────────────────────────────────────────────────

function BranchLanes({
  spec,
  step,
  depth,
  ordinalMap,
  selectedStepId,
  unacceptedIds,
  onClickStep,
  onDeleteStep,
  onOpenPalette,
}: {
  spec: WorkflowSpec;
  step: StepNode;
  depth: number;
  ordinalMap: Map<string, string>;
  selectedStepId?: string;
  unacceptedIds?: Set<string>;
  onClickStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
  onOpenPalette: (slot: SlotTarget) => void;
}) {
  const branches = (step as { branches?: Record<string, string> }).branches ?? {};
  const labels = Object.keys(branches);

  const ordered = [...labels].sort((a, b) => {
    if (a === "true") return -1;
    if (b === "true") return 1;
    if (a === "false") return -1;
    if (b === "false") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="relative flex gap-3">
      {/* Rail column connects the branch step's chip to the lanes below */}
      <RailColumn lineVariant="down" chipPosition="top">
        <span aria-hidden />
      </RailColumn>

      <div className="mt-1 grid flex-1 gap-3 sm:grid-cols-2">
        {ordered.map((label) => {
          const target = branches[label];
          return (
            <div
              key={label}
              className="overflow-hidden rounded-lg border border-border/60 bg-muted/[0.06]"
            >
              <BranchHeader label={label} />
              <div className="p-2">
                <Rail
                  spec={spec}
                  startId={target}
                  parentForInsert={{ parentId: step.id, branch: label }}
                  depth={depth + 1}
                  ordinalMap={ordinalMap}
                  selectedStepId={selectedStepId}
                  unacceptedIds={unacceptedIds}
                  onClickStep={onClickStep}
                  onDeleteStep={onDeleteStep}
                  onOpenPalette={onOpenPalette}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BranchHeader({ label }: { label: string }) {
  const tone =
    label === "true"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : label === "false"
        ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
        : "bg-muted text-muted-foreground";

  const text =
    label === "true"
      ? "If true"
      : label === "false"
        ? "If false"
        : label === "_default"
          ? "Otherwise"
          : label;

  return (
    <div className={cn("flex items-center gap-1 border-b border-border/40 px-3 py-1.5", tone)}>
      <GitBranch className="size-3" aria-hidden />
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">{text}</span>
    </div>
  );
}

// ─── End / empty primitives ────────────────────────────────────────────────

function EndRow() {
  return (
    <div className="relative flex gap-3 py-2">
      <RailColumn lineVariant="up" chipPosition="center">
        <RailChip variant="muted">
          <CheckCircle2 className="size-3.5" aria-hidden />
        </RailChip>
      </RailColumn>
      <div className="flex flex-1 items-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          End
        </span>
      </div>
    </div>
  );
}

// A real `control.end` step rendered as the terminal marker. Clickable to edit
// its outcome label, but not deletable from here — a branch lane points at it,
// and dropping it would dangle the branch. Visually mirrors EndRow.
function EndStepRow({
  selected,
  outcome,
  onClick,
}: {
  selected: boolean;
  outcome?: string;
  onClick: () => void;
}) {
  return (
    <div className="relative flex gap-3 py-1">
      <RailColumn lineVariant="up" chipPosition="center">
        <RailChip variant="muted">
          <CheckCircle2 className="size-3.5" aria-hidden />
        </RailChip>
      </RailColumn>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex flex-1 items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/60 hover:bg-muted/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "border-border/60 bg-muted/[0.06]",
        )}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          End
        </span>
        {outcome ? (
          <span className="rounded-sm bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {outcome}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function EmptyLane({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="my-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-background/40 px-3 py-3 text-[12px] text-muted-foreground hover:border-primary hover:text-primary"
    >
      <Plus className="size-3.5" aria-hidden />
      Add the first step in this branch
    </button>
  );
}

// ─── Palette dialog ─────────────────────────────────────────────────────────

const SURFACE_ORDER: Surface[] = [
  "ai",
  "control",
  "tasks",
  "chat",
  "docs",
  "meetings",
  "calendar",
  "entities",
  "system",
  "external",
];

const SURFACE_DISPLAY: Record<Surface, string> = {
  ai: "AI",
  control: "Logic",
  tasks: "Tasks",
  chat: "Chat",
  docs: "Docs",
  meetings: "Meetings",
  calendar: "Calendar",
  entities: "Entities",
  system: "System",
  external: "External",
};

function PaletteDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (type: StepType) => void;
}) {
  const [query, setQuery] = useState("");
  const [surfaceFilter, setSurfaceFilter] = useState<Surface | "all">("all");

  // Reset transient state when reopened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSurfaceFilter("all");
    }
  }, [open]);

  // Counts per surface (independent of filter so chips show real totals).
  const countsBySurface = useMemo(() => {
    const map = new Map<Surface, number>();
    for (const s of STEPS) {
      map.set(s.surface, (map.get(s.surface) ?? 0) + 1);
    }
    return map;
  }, []);

  const activeSurfaces = useMemo(
    () => SURFACE_ORDER.filter((s) => (countsBySurface.get(s) ?? 0) > 0),
    [countsBySurface],
  );

  // Visible steps, grouped by surface, after search + filter.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = STEPS.filter((s) => {
      if (surfaceFilter !== "all" && s.surface !== surfaceFilter) return false;
      if (!q) return true;
      return (
        s.label.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });
    const map = new Map<Surface, StepCatalogEntry[]>();
    for (const s of matches) {
      const k = s.surface;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return SURFACE_ORDER.filter((s) => map.has(s)).map(
      (s) => [s, map.get(s)!] as const,
    );
  }, [query, surfaceFilter]);

  const totalVisible = grouped.reduce((acc, [, list]) => acc + list.length, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* sm:!max-w-4xl overrides the shadcn DialogContent default of
       * sm:max-w-sm (which otherwise wins at the sm breakpoint and pins the
       * modal to 384px). */}
      <DialogContent className="flex max-h-[85vh] w-full max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:!max-w-4xl">
        <DialogHeader className="space-y-3 border-b p-4">
          <div>
            <DialogTitle className="text-[14px]">Add a step</DialogTitle>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Pick what should happen next. Search by name or browse by category.
            </p>
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search steps — “summarize”, “notify”, “branch”…"
            autoFocus
            className="h-9 text-[13px]"
          />
          {/* Surface filter chips */}
          <div className="-mx-1 flex flex-wrap items-center gap-1">
            <FilterChip
              label="All"
              count={STEPS.length}
              active={surfaceFilter === "all"}
              onClick={() => setSurfaceFilter("all")}
            />
            {activeSurfaces.map((s) => (
              <FilterChip
                key={s}
                label={SURFACE_DISPLAY[s]}
                count={countsBySurface.get(s) ?? 0}
                active={surfaceFilter === s}
                onClick={() => setSurfaceFilter(s)}
                tone={s}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {totalVisible === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
              <p className="text-[13px] font-medium text-foreground">
                No steps match
              </p>
              <p className="text-[12px] text-muted-foreground">
                Try a different search or category.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([surface, items]) => (
                <section key={surface}>
                  <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {SURFACE_DISPLAY[surface]}
                    <span className="rounded-sm bg-muted/40 px-1.5 font-mono text-[10px] text-muted-foreground">
                      {items.length}
                    </span>
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((s) => (
                      <PaletteCard
                        key={s.id}
                        entry={s}
                        onClick={() => onPick(s.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: Surface;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
      )}
    >
      {tone && (
        <SurfaceBadge
          surface={tone}
          className={cn("!size-3.5", active && "opacity-90")}
        />
      )}
      {label}
      <span
        className={cn(
          "rounded-sm px-1 font-mono text-[10px]",
          active
            ? "bg-background/20 text-background/80"
            : "bg-muted/40 text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function PaletteCard({
  entry,
  onClick,
}: {
  entry: StepCatalogEntry;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3 text-left transition-all hover:-translate-y-px hover:border-primary/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SurfaceBadge surface={entry.surface} className="mt-0.5 !size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
          {entry.label}
        </p>
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
          {entry.description}
        </p>
        <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground/70">
          {entry.id}
        </p>
      </div>
    </button>
  );
}

// ─── Walk + ordinal helpers ────────────────────────────────────────────────

function walkChain(spec: WorkflowSpec, startId: string | undefined): StepNode[] {
  if (!startId) return [];
  const chain: StepNode[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = startId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const step: StepNode | undefined = spec.steps[cursor];
    if (!step) break;
    chain.push(step);
    if (isBranchStep(step)) break;
    cursor = (step as { next?: string }).next;
  }
  return chain;
}

function isBranchStep(step: StepNode): boolean {
  return "branches" in step;
}

const BRANCH_TYPES = new Set<StepType>([
  "control.branch_if",
  "control.branch_switch",
  "ai.branch_decision",
]);

function isBranchType(type: StepType): boolean {
  return BRANCH_TYPES.has(type);
}

/** A control.end with no analytics outcome — a plain "this path ends" node. */
function isBareEnd(step: StepNode | undefined): boolean {
  return (
    !!step &&
    step.type === "control.end" &&
    !(step as { config?: { outcome?: string } }).config?.outcome
  );
}

/** Next unique "control_end_N" id against an in-progress steps map. */
function freshEndId(steps: Record<string, StepNode>): string {
  let i = 1;
  let id = `control_end_${i}`;
  while (steps[id]) {
    i += 1;
    id = `control_end_${i}`;
  }
  return id;
}

/**
 * Remove a step, splicing it out: every reference to it (a linear `.next` or a
 * branch target) is reconnected to the step's own `.next`. Branch keys must
 * always point at a real step, so when there's no successor we substitute a
 * fresh bare End — the lane reverts to empty rather than dangling (which would
 * fail save-time validation). Orphaned bare Ends are then pruned.
 */
function deleteStepSpliced(spec: WorkflowSpec, id: string): WorkflowSpec {
  const victim = spec.steps[id];
  if (!victim) return spec;
  const succ = (victim as { next?: string }).next;

  const steps: Record<string, StepNode> = { ...spec.steps };
  delete steps[id];

  const hasSucc = (s: string | undefined): s is string => !!s && !!steps[s];

  const branchTarget = (): string => {
    if (hasSucc(succ)) return succ;
    const endId = freshEndId(steps);
    steps[endId] = { id: endId, type: "control.end", config: {} } as StepNode;
    return endId;
  };

  for (const [sid, s] of Object.entries(steps)) {
    let updated = s;
    if ((s as { next?: string }).next === id) {
      updated = { ...updated, next: hasSucc(succ) ? succ : undefined } as StepNode;
    }
    const branches = (s as { branches?: Record<string, string> }).branches;
    if (branches) {
      let changed = false;
      const nextBranches = { ...branches };
      for (const [k, t] of Object.entries(branches)) {
        if (t === id) {
          nextBranches[k] = branchTarget();
          changed = true;
        }
      }
      if (changed) updated = { ...updated, branches: nextBranches } as StepNode;
    }
    if (updated !== s) steps[sid] = updated;
  }

  const entry_step_id =
    spec.entry_step_id === id ? (hasSucc(succ) ? succ : "") : spec.entry_step_id;

  const pruned = pruneOrphanBareEnds(steps, entry_step_id);

  let layout = spec.layout;
  if (layout) {
    layout = { ...layout };
    for (const k of Object.keys(layout)) if (!pruned[k]) delete layout[k];
  }

  return { ...spec, steps: pruned, entry_step_id, layout };
}

/** Drop bare End nodes that nothing points at (and that aren't the entry). */
function pruneOrphanBareEnds(
  steps: Record<string, StepNode>,
  entryId: string,
): Record<string, StepNode> {
  const referenced = new Set<string>();
  if (entryId) referenced.add(entryId);
  for (const s of Object.values(steps)) {
    const n = (s as { next?: string }).next;
    if (n) referenced.add(n);
    const branches = (s as { branches?: Record<string, string> }).branches;
    if (branches) for (const t of Object.values(branches)) referenced.add(t);
  }
  const out: Record<string, StepNode> = {};
  for (const [id, s] of Object.entries(steps)) {
    if (isBareEnd(s) && !referenced.has(id)) continue;
    out[id] = s;
  }
  return out;
}

/**
 * Walk the spec depth-first and assign each step an ordinal string. Branch
 * children get prefixed numbers ("2a.1", "2b.1") so users can talk about
 * "step 2a.1" unambiguously across all branches.
 */
function buildOrdinals(spec: WorkflowSpec): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<string>();

  function visit(startId: string | undefined, prefix: string, startCount: number) {
    if (!startId) return;
    let n = startCount;
    let cursor: string | undefined = startId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const step: StepNode | undefined = spec.steps[cursor];
      if (!step) break;
      const label = prefix ? `${prefix}.${n}` : `${n}`;
      out.set(step.id, label);

      if (isBranchStep(step)) {
        const branches =
          (step as { branches?: Record<string, string> }).branches ?? {};
        const branchKeys = Object.keys(branches).sort((a, b) => {
          if (a === "true") return -1;
          if (b === "true") return 1;
          if (a === "false") return -1;
          if (b === "false") return 1;
          return a.localeCompare(b);
        });
        const ALPHA = "abcdefghijklmnop";
        branchKeys.forEach((key, idx) => {
          const childPrefix = `${label}${ALPHA[idx] ?? key[0]!}`;
          visit(branches[key], childPrefix, 1);
        });
        break;
      }
      cursor = (step as { next?: string }).next;
      n += 1;
    }
  }

  visit(spec.entry_step_id, "", 1);
  return out;
}

/**
 * For every step in the spec, map its id → the sortable chain (linear,
 * non-branch ids) it belongs to. Drag-end uses this to (a) reject cross-
 * chain drops and (b) know which predecessor edge needs rewriting.
 */
function buildChainMap(spec: WorkflowSpec): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const seenStarts = new Set<string>();

  function visit(startId: string | undefined) {
    if (!startId || seenStarts.has(startId)) return;
    seenStarts.add(startId);
    const fullChain = walkChain(spec, startId);
    const sortable = fullChain
      .filter((s) => !isBranchStep(s) && s.type !== "control.end")
      .map((s) => s.id);
    for (const id of sortable) out.set(id, sortable);
    // Recurse into branch lanes
    const tail = fullChain[fullChain.length - 1];
    if (tail && isBranchStep(tail)) {
      const branches =
        (tail as { branches?: Record<string, string> }).branches ?? {};
      for (const target of Object.values(branches)) visit(target);
    }
  }

  visit(spec.entry_step_id);
  return out;
}

/**
 * Apply a reorder to a chain by rewriting the `.next` pointers + the
 * predecessor edge that pointed at the chain's old head.
 *
 *   • Predecessor edge: whichever step (or `entry_step_id`) targeted
 *     `oldChain[0]` now targets `newOrder[0]`.
 *   • Inside the chain: each step's `.next` becomes the id that follows it
 *     in the new order, or the original chain-tail's `.next` for the new
 *     last item (so any out-of-chain successor — e.g. a branch step — keeps
 *     getting reached).
 */
function rewriteChainOrder(
  spec: WorkflowSpec,
  oldChain: string[],
  newOrder: string[],
): WorkflowSpec {
  if (oldChain.length === 0) return spec;
  const oldHead = oldChain[0]!;
  const newHead = newOrder[0]!;
  const tailNext =
    (spec.steps[oldChain[oldChain.length - 1]!] as { next?: string } | undefined)
      ?.next;

  const nextSteps: Record<string, StepNode> = { ...spec.steps };

  // Rewrite inside the chain
  newOrder.forEach((id, i) => {
    const step = nextSteps[id];
    if (!step) return;
    const newNext =
      i < newOrder.length - 1 ? newOrder[i + 1] : tailNext;
    nextSteps[id] = { ...step, next: newNext } as StepNode;
  });

  // Rewrite predecessor edges that pointed at the old head
  for (const [id, step] of Object.entries(nextSteps)) {
    if (newOrder.includes(id)) continue; // already handled above
    if ((step as { next?: string }).next === oldHead) {
      nextSteps[id] = { ...step, next: newHead } as StepNode;
    }
    if ("branches" in step) {
      const branches = {
        ...(step as { branches: Record<string, string> }).branches,
      };
      let changed = false;
      for (const [k, v] of Object.entries(branches)) {
        if (v === oldHead) {
          branches[k] = newHead;
          changed = true;
        }
      }
      if (changed) nextSteps[id] = { ...step, branches } as StepNode;
    }
  }

  const entry_step_id =
    spec.entry_step_id === oldHead ? newHead : spec.entry_step_id;

  return { ...spec, steps: nextSteps, entry_step_id };
}
