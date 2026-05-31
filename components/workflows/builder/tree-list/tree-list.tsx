"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
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

// Fixed card width. Cards hang off the left rail at a comfortable reading width
// (rather than stretching the whole canvas), so a branch can place two of them
// side by side. The lane width below is this + the nested rail + padding.
const CARD_W = "w-[460px]";
const LANE_W = "w-[500px]";

export function TreeList({
  spec,
  isDurable,
  selectedStepId,
  onSelectStep,
  onChange,
  unacceptedIds,
  invalidById,
}: {
  spec: WorkflowSpec;
  isDurable: boolean;
  selectedStepId?: string;
  onSelectStep?: (stepId: string) => void;
  onChange?: (next: WorkflowSpec) => void;
  unacceptedIds?: Set<string>;
  /** step id → first inline validation message, shown on the card. */
  invalidById?: Map<string, string>;
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

  const draggingStep = draggingId ? spec.steps[draggingId] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <div className="w-fit">
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
        invalidById={invalidById}
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

      {/* Floating clone that tracks the cursor during a drag. The source row
       * stays put as a dimmed placeholder (see StepRow), so this is the only
       * thing that moves — a far clearer signal than nudging the in-place card. */}
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2,0.7,0.5,1.1)" }}>
        {draggingStep ? (
          <StepDragCard
            step={draggingStep}
            ordinal={ordinalMap.get(draggingStep.id) ?? "•"}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// Presentational clone shown inside <DragOverlay> while a step is being
// dragged. Mirrors the StepRow card's look (badge · category · name · summary)
// with a "lifted" treatment, minus the sortable wiring and hover actions.
function StepDragCard({ step, ordinal }: { step: StepNode; ordinal: string }) {
  const meta = getStep(step.type);
  const surface = (meta?.surface ?? "system") as Surface;
  const summary = meta?.explain((step as { config?: unknown }).config) ?? step.id;
  const isAi = surface === "ai";
  const isBranch = isBranchStep(step);
  const category = isBranch ? "Decision" : isAi ? "AI action" : "Action";

  return (
    <div className="flex cursor-grabbing items-stretch gap-3">
      <div className="flex w-9 shrink-0 items-center justify-center">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-background text-[11px] font-semibold tabular-nums text-foreground ring-1 ring-black/10 dark:ring-white/10">
          {ordinal}
        </span>
      </div>
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border border-primary/50 bg-card p-3.5 shadow-2xl ring-1 ring-primary/30 [transform:rotate(-1deg)]",
          CARD_W,
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
            {isAi && <Sparkles className="size-3 shrink-0 text-primary" aria-hidden />}
            {isBranch && <GitBranch className="size-3 shrink-0 text-amber-500" aria-hidden />}
          </div>
          <p className="mt-0.5 truncate text-[13.5px] font-semibold text-foreground">
            {step.label || meta?.label || step.type}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{summary}</p>
        </div>
      </div>
    </div>
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
          "group mb-1 flex items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-all",
          CARD_W,
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
  invalidById,
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
  invalidById?: Map<string, string>;
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
                invalidReason={invalidById?.get(step.id)}
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
                  invalidById={invalidById}
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
        "inline-flex items-center justify-center rounded-full border tabular-nums",
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
      <div className={cn("flex items-center justify-center", CARD_W)}>
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-background/60 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground opacity-60 transition-all hover:border-primary hover:bg-background hover:text-primary hover:opacity-100 group-hover/insert:opacity-100"
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
  invalidReason,
  draggable,
  onClick,
  onDelete,
}: {
  step: StepNode;
  ordinal: string;
  selected: boolean;
  unaccepted?: boolean;
  /** First validation problem on this step, shown inline. */
  invalidReason?: string;
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
        sortable.isDragging && "opacity-40",
      )}
    >
      <RailColumn lineVariant="full" chipPosition="center">
        {/* Chip — visual only. Drag is captured at the row level. The grip
         * icon appears on row hover to advertise the affordance. */}
        <div
          aria-hidden
          className="relative inline-flex size-7 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold tabular-nums text-foreground"
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
          "group relative mb-1 flex items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          CARD_W,
          selected
            ? "border-primary ring-2 ring-primary/30"
            : invalidReason
              ? "border-destructive/60 hover:border-destructive"
              : "border-border/60 hover:border-foreground/30",
          unaccepted && "ring-2 ring-[var(--chart-2)]/60",
          sortable.isDragging && "border-dashed border-primary/40 bg-muted/20",
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
          <p className="mt-0.5 truncate text-[13.5px] font-semibold text-foreground">
            {step.label || meta?.label || step.type}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">
            {summary}
          </p>
          {invalidReason && (
            <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-destructive">
              <span aria-hidden>▲</span> {invalidReason}
            </p>
          )}
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
  invalidById,
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
  invalidById?: Map<string, string>;
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
      {/* Rail column carries the main vertical line down past the branch */}
      <RailColumn lineVariant="down" chipPosition="top">
        <span aria-hidden />
      </RailColumn>

      <div className="w-fit">
        <BranchFork lanes={ordered.length} />
        <div className="flex gap-3">
          {ordered.map((label) => {
            const target = branches[label];
            return (
              <div
                key={label}
                className={cn(
                  "shrink-0 overflow-hidden rounded-xl border bg-muted/[0.04]",
                  LANE_W,
                  laneBorder(label),
                )}
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
                    invalidById={invalidById}
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
    </div>
  );
}

// Connector between the decision card and its lanes: a short stem that forks
// left/right into the two columns (the if/else case). A single lane — or an
// unusual >2 fan-out that wraps the grid — degrades to a plain stem so the
// connector never lies about where paths go.
function BranchFork({ lanes }: { lanes: number }) {
  if (lanes !== 2) {
    return <div className="mx-auto h-3.5 w-px bg-border" aria-hidden />;
  }
  return (
    <div className="relative h-4" aria-hidden>
      <span className="absolute top-0 left-1/2 h-2 w-px -translate-x-1/2 bg-border" />
      <span className="absolute top-2 right-1/4 left-1/4 h-px bg-border" />
      <span className="absolute top-2 left-1/4 h-2 w-px bg-border" />
      <span className="absolute top-2 right-1/4 h-2 w-px bg-border" />
    </div>
  );
}

function laneBorder(label: string): string {
  if (label === "true") return "border-emerald-500/25";
  if (label === "false") return "border-rose-500/25";
  return "border-border/60";
}

function BranchHeader({ label }: { label: string }) {
  const tone =
    label === "true"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : label === "false"
        ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
        : "bg-muted/40 text-muted-foreground";

  const text =
    label === "true"
      ? "If true"
      : label === "false"
        ? "If false"
        : label === "_default"
          ? "Otherwise"
          : label;

  return (
    <div className={cn("flex items-center gap-1.5 border-b border-border/40 px-3 py-2", tone)}>
      <GitBranch className="size-3 shrink-0" aria-hidden />
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

// The 80% hotel-ops set, pinned to the top when there's no query.
const COMMON_STEP_IDS: StepType[] = [
  "action.task.create",
  "action.chat.post_message",
  "action.notify.role",
  "control.branch_if",
  "control.branch_switch",
  "ai.classify_into",
  "ai.summarize_text",
  "control.delay",
];

interface PaletteSection {
  title: string;
  items: StepCatalogEntry[];
}

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
  const [activeIndex, setActiveIndex] = useState(0);
  // Only auto-scroll the active row into view when it was moved by the keyboard.
  // Hover-driven changes must never scroll, or the scroll shifts rows under the
  // cursor and triggers another mousemove → active change → scroll feedback loop.
  const keyboardNav = useRef(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      keyboardNav.current = false;
    }
  }, [open]);

  // Sections shown in the list. No query → Common + each surface group.
  // Query → a single ranked "Matches" section (label/id/description/prompts).
  const sections = useMemo<PaletteSection[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const scored = STEPS.map((s) => {
        const hay = `${s.label} ${s.id} ${s.description} ${s.examplePrompts.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return null;
        // Rank: label prefix > label includes > other.
        const label = s.label.toLowerCase();
        const rank = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
        return { s, rank };
      }).filter((x): x is { s: StepCatalogEntry; rank: number } => x !== null);
      scored.sort((a, b) => a.rank - b.rank);
      return scored.length ? [{ title: "Matches", items: scored.map((x) => x.s) }] : [];
    }
    const byId = new Map(STEPS.map((s) => [s.id, s]));
    const common = COMMON_STEP_IDS.map((id) => byId.get(id)).filter(
      (s): s is StepCatalogEntry => Boolean(s),
    );
    const groups: PaletteSection[] = SURFACE_ORDER.map((surface) => ({
      title: SURFACE_DISPLAY[surface],
      items: STEPS.filter((s) => s.surface === surface),
    })).filter((g) => g.items.length > 0);
    return [{ title: "Common", items: common }, ...groups];
  }, [query]);

  // Flat list of items in display order for arrow-key navigation. Clamp the
  // active index at render time (results shrink as the query narrows) rather
  // than syncing it through an effect.
  const flat = useMemo(() => sections.flatMap((sec) => sec.items), [sections]);
  const safeIndex = flat.length === 0 ? 0 : Math.min(activeIndex, flat.length - 1);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      keyboardNav.current = true;
      setActiveIndex(Math.min(safeIndex + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyboardNav.current = true;
      setActiveIndex(Math.max(safeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flat[safeIndex];
      if (pick) onPick(pick.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:!max-w-2xl">
        <DialogHeader className="border-b p-0">
          <DialogTitle className="sr-only">Add a step</DialogTitle>
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search steps — try “notify”, “summarize”, “if”…"
            autoFocus
            className="h-12 rounded-none border-0 px-4 text-[14px] focus-visible:ring-0"
          />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-1.5">
          {flat.length === 0 ? (
            <p className="px-3 py-12 text-center text-[12.5px] text-muted-foreground">
              No steps match “{query}”.
            </p>
          ) : (
            sections.map((sec) => (
              <section key={sec.title} className="mb-1.5 last:mb-0">
                <h3 className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {sec.title}
                </h3>
                {sec.items.map((entry) => {
                  const idx = flat.indexOf(entry);
                  return (
                    <PaletteRow
                      key={`${sec.title}:${entry.id}`}
                      entry={entry}
                      active={idx === safeIndex}
                      scrollOnActive={keyboardNav.current}
                      onHover={() => {
                        keyboardNav.current = false;
                        setActiveIndex(idx);
                      }}
                      onClick={() => onPick(entry.id)}
                    />
                  );
                })}
              </section>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10.5px] text-muted-foreground">
          <span><kbd className="font-sans">↑↓</kbd> navigate</span>
          <span><kbd className="font-sans">↵</kbd> add</span>
          <span><kbd className="font-sans">esc</kbd> close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaletteRow({
  entry,
  active,
  scrollOnActive,
  onHover,
  onClick,
}: {
  entry: StepCatalogEntry;
  active: boolean;
  scrollOnActive: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active && scrollOnActive) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active, scrollOnActive]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseMove={onHover}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
        active ? "bg-secondary" : "hover:bg-secondary/60",
      )}
    >
      <SurfaceBadge surface={entry.surface} className="!size-7 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{entry.label}</p>
        <p className="truncate text-[11.5px] text-muted-foreground">{entry.description}</p>
      </div>
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/60">
        {SURFACE_DISPLAY[entry.surface]}
      </span>
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
