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
  Copy,
  GripVertical,
  LayoutGrid,
  Plus,
  Search,
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
import {
  SurfaceBadge,
  SurfaceLabelBadge,
  surfaceMeta,
} from "@/components/workflows/builder/surface-badge";
import {
  getStep,
  getTrigger,
  STEPS,
} from "@/lib/workflows/catalog";
import type { StepCatalogEntry, Surface } from "@/lib/workflows/catalog/types";
import type { StepNode, StepType, WorkflowSpec } from "@/lib/workflows/spec";
import { nextStepId, TRIGGER_NODE_ID } from "@/lib/workflows/graph";
import { NodeInspector } from "@/components/workflows/builder/canvas/node-inspector";
import { panToBranchLane, panToWorkflowStep } from "@/components/workflows/builder/pan-to-target";
import {
  findStepBranchContext,
  getBranchPaths,
  type BranchPathKey,
} from "@/lib/workflows/branch-paths";
import type { BranchPathFocus } from "@/components/workflows/builder/branch-path-context-bar";
import { triggerFilterChips } from "@/lib/workflows/trigger-filter";

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

const RAIL_W = "w-8"; // 32px column for the rail
const LINE_LEFT = "left-[15px]"; // line sits in the middle of the rail column

// Line variants — each row draws its share of the continuous rail. Rows are
// stacked with a 12px flex gap (ROW_STACK_GAP), which a row-local `inset-y-0`
// line can't reach across — leaving a blank break at every seam. So the
// downward-flowing variants bleed one full gap (-bottom-3 = 12px) past the row,
// meeting the next row's top edge so the rail reads as continuous. Terminals
// (End markers) always use the `up` variant, so this bleed never dangles below
// the last node; lanes additionally clip it with their own overflow-hidden.
const LINE_FULL = "absolute top-0 -bottom-3 w-px bg-border/60";
const LINE_DOWN = "absolute top-1/2 -bottom-3 w-px bg-border/60";
const LINE_UP = "absolute top-0 bottom-1/2 w-px bg-border/60";
// Like `down`, but for a branch decision — which always owns the chain tail, so
// its trunk stops at the row edge instead of bleeding toward a (non-existent)
// next sibling.
const LINE_DOWN_TAIL = "absolute top-1/2 bottom-0 w-px bg-border/60";

// Fixed card width. Cards hang off the left rail at a comfortable reading width
// (rather than stretching the whole canvas), so a branch can place two of them
// side by side. The lane width below is this + the nested rail + padding.
const CARD_W = "w-[400px]";
const LANE_W = "w-[420px]";
/** Vertical breathing room between step cards, insert rows, and branch lanes. */
const ROW_STACK_GAP = "gap-3";

// Branch-fork connector geometry (px). The fork hangs the lanes off the decision
// card's rail rather than floating a separate centred stem: a short STEM
// continues the trunk down, a horizontal bar reaches across, and a DROP lands on
// each lane's *own* rail line. The X offsets are derived from the rail/lane
// metrics above so every drop lines up with the lane's internal rail:
//   • trunk sits at LINE_LEFT (15px).
//   • lane content starts at RAIL_W (32) + gap-3 (12) = 44px (≙ `pl-11`), and each
//     lane's rail is a further p-2 (8) + LINE_LEFT (15) = 23px in → first at 67px.
//   • lanes stride by LANE_W (420) + gap-4 (16) = 436px.
const BRANCH_STEM_H = 14;
const BRANCH_DROP_H = 14;
const BRANCH_TRUNK_X = 15;
const BRANCH_LANE_RAIL_X = 67;
const BRANCH_LANE_STRIDE = 436;

// Shared card styling — mirrors task-card.tsx (rounded-md, border-border/70, p-3).
const FLOW_CARD = cn(
  "relative rounded-md border border-border/70 bg-card p-3 text-left shadow-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

function flowCardTone({
  selected,
  invalid,
  unaccepted,
  dragging,
  className,
}: {
  selected?: boolean;
  invalid?: boolean;
  unaccepted?: boolean;
  dragging?: boolean;
  className?: string;
}) {
  return cn(
    FLOW_CARD,
    !selected && !invalid && "hover:border-foreground/15",
    selected && "border-foreground/20 ring-1 ring-foreground/10",
    invalid && "border-destructive/50 hover:border-destructive/70",
    unaccepted && "ring-1 ring-amber-500/25",
    dragging && "border-dashed border-foreground/20 bg-muted/20 opacity-40",
    className,
  );
}

function StepMeta({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.75rem] leading-4 text-muted-foreground">{children}</p>
  );
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="line-clamp-2 text-[0.8125rem] font-medium leading-4.5 text-foreground">
      {children}
    </p>
  );
}

function StepSummary({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 line-clamp-2 text-[0.75rem] leading-4 text-muted-foreground">
      {children}
    </p>
  );
}

export function TreeList({
  spec,
  propertyId,
  isDurable,
  selectedStepId,
  onSelectStep,
  onChange,
  unacceptedIds,
  invalidById,
  warningById,
  webhookToken,
}: {
  spec: WorkflowSpec;
  propertyId?: string;
  isDurable: boolean;
  selectedStepId?: string;
  onSelectStep?: (stepId: string) => void;
  onChange?: (next: WorkflowSpec) => void;
  unacceptedIds?: Set<string>;
  /** step id → first inline error message, shown in red on the card. */
  invalidById?: Map<string, string>;
  /** step id → first non-blocking warning (orphan/cycle), shown in amber. */
  warningById?: Map<string, string>;
  /** Per-workflow webhook token, forwarded to the trigger inspector. */
  webhookToken?: string | null;
}) {
  const [paletteAt, setPaletteAt] = useState<SlotTarget | null>(null);
  const [inspectorOpenFor, setInspectorOpenFor] = useState<string | null>(null);
  const [branchPathFocus, setBranchPathFocus] = useState<BranchPathFocus | null>(null);

  const selectStep = useCallback(
    (id: string) => {
      onSelectStep?.(id);
      setInspectorOpenFor(id);
      const lane = findStepBranchContext(spec, id);
      if (lane) {
        setBranchPathFocus({ branchStepId: lane.branchStepId, key: lane.branchKey });
      } else if (branchPathFocus?.branchStepId !== id) {
        setBranchPathFocus(null);
      }
    },
    [onSelectStep, spec, branchPathFocus?.branchStepId],
  );

  const configureBranchPath = useCallback(
    (branchStepId: string, branchKey: BranchPathKey) => {
      setBranchPathFocus({ branchStepId, key: branchKey });
      setInspectorOpenFor(branchStepId);
      onSelectStep?.(branchStepId);

      const path = getBranchPaths(spec, branchStepId).find((p) => p.key === branchKey);
      if (!path) return;

      if (path.isEmpty) {
        setPaletteAt({ parentId: branchStepId, branch: branchKey });
        requestAnimationFrame(() => panToBranchLane(branchStepId, branchKey));
        return;
      }

      const targetId = path.headStepId ?? path.targetStepId;
      if (!targetId) return;
      onSelectStep?.(targetId);
      setInspectorOpenFor(targetId);
      const lane = findStepBranchContext(spec, targetId);
      if (lane) {
        setBranchPathFocus({ branchStepId: lane.branchStepId, key: lane.branchKey });
      }
      requestAnimationFrame(() => panToWorkflowStep(targetId));
    },
    [spec, onSelectStep],
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

  // Clone a linear step (action/AI) and splice the copy in right after it.
  // Branch and End steps aren't duplicable here — branches own a whole subtree.
  const duplicateStep = useCallback(
    (id: string) => {
      if (!onChange) return;
      const step = spec.steps[id];
      if (!step || isBranchStep(step) || step.type === "control.end") return;
      const newId = nextStepId(spec, step.type);
      const label = (step as { label?: string }).label;
      const succ = (step as { next?: string }).next;
      const clone = {
        ...(step as object),
        id: newId,
        label: label ? `${label} copy` : undefined,
        next: succ, // clone continues to the original's successor…
      } as StepNode;
      const steps: Record<string, StepNode> = {
        ...spec.steps,
        [newId]: clone,
        [id]: { ...(step as object), next: newId } as StepNode, // …and the original points to the clone
      };
      onChange({ ...spec, steps });
      setInspectorOpenFor(newId);
      onSelectStep?.(newId);
    },
    [spec, onChange, onSelectStep],
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
      <div className={cn("flex w-fit flex-col", ROW_STACK_GAP)}>
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
        warningById={warningById}
        branchPathFocus={branchPathFocus}
        onClickStep={selectStep}
        onDeleteStep={deleteStep}
        onDuplicateStep={duplicateStep}
        onOpenPalette={setPaletteAt}
      />

      <PaletteDialog
        open={paletteAt !== null}
        onClose={() => setPaletteAt(null)}
        onPick={(type) => paletteAt && insertStep(type, paletteAt)}
      />

      <NodeInspector
        spec={spec}
        propertyId={propertyId}
        selectedNodeId={inspectorOpenFor}
        onClose={() => {
          setInspectorOpenFor(null);
          setBranchPathFocus(null);
        }}
        onChange={(next) => onChange?.(next)}
        onStepRenamed={setInspectorOpenFor}
        onConfigureBranchPath={configureBranchPath}
        branchPathFocus={branchPathFocus}
        onOpenBranchStep={(branchStepId) => {
          setInspectorOpenFor(branchStepId);
          onSelectStep?.(branchStepId);
          requestAnimationFrame(() => panToWorkflowStep(branchStepId));
        }}
        onOpenBranchPath={(branchStepId, branchKey) => configureBranchPath(branchStepId, branchKey)}
        webhookToken={webhookToken}
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
      <div className="flex w-8 shrink-0 items-center justify-center">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-background text-[0.625rem] font-medium tabular-nums text-muted-foreground ring-1 ring-black/10 dark:ring-white/10">
          {ordinal}
        </span>
      </div>
      <div className={cn(flowCardTone({ className: CARD_W }), "shadow-lg ring-1 ring-black/10 dark:ring-white/10")}>
        <StepMeta>{category}</StepMeta>
        <div className="mt-2 flex items-start gap-2">
          <SurfaceBadge surface={surface} className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <StepTitle>{step.label || meta?.label || step.type}</StepTitle>
            <StepSummary>{summary}</StepSummary>
          </div>
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
  const summary = trigger?.explain(spec.trigger.filter?.expr) ?? "";
  const chips = useMemo(
    () => triggerFilterChips(spec.trigger.event_type, spec.trigger.filter?.expr),
    [spec.trigger.event_type, spec.trigger.filter?.expr],
  );

  return (
    <div className="relative flex gap-3">
      <RailColumn lineVariant="down" chipPosition="center">
        <RailChip variant="trigger">T</RailChip>
      </RailColumn>

      <button
        type="button"
        onClick={onEdit}
        className={cn(
          flowCardTone({ selected, className: cn("group", CARD_W) }),
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <StepMeta>Trigger</StepMeta>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
              isDurable
                ? "bg-muted text-muted-foreground"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
            )}
          >
            {isDurable ? "Waits for events" : "Runs once"}
          </span>
        </div>
        <div className="mt-2 flex items-start gap-2">
          <SurfaceBadge surface={trigger?.surface ?? "system"} className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <StepTitle>{trigger?.label ?? spec.trigger.event_type}</StepTitle>
            <StepSummary>{summary}</StepSummary>
            {chips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {chips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex max-w-full truncate rounded-md bg-muted/80 px-1.5 py-0.5 text-[0.6875rem] font-medium text-foreground/80"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
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
  isLane,
  ordinalMap,
  selectedStepId,
  unacceptedIds,
  invalidById,
  warningById,
  branchPathFocus,
  onClickStep,
  onDeleteStep,
  onDuplicateStep,
  onOpenPalette,
}: {
  spec: WorkflowSpec;
  startId: string | undefined;
  parentForInsert: SlotTarget;
  depth: number;
  /** This rail is a branch lane — the fork connector already links it to its
   *  parent, so an empty lane shows just the CTA (no orphan up-rail stub). */
  isLane?: boolean;
  ordinalMap: Map<string, string>;
  selectedStepId?: string;
  unacceptedIds?: Set<string>;
  invalidById?: Map<string, string>;
  warningById?: Map<string, string>;
  branchPathFocus?: BranchPathFocus | null;
  onClickStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  onOpenPalette: (slot: SlotTarget) => void;
}) {
  const chain = useMemo(() => walkChain(spec, startId), [spec, startId]);

  // Empty lane fallback — shown inside a branch column when its slot is unset
  // OR when it holds only a freshly-seeded bare End (the path ends with nothing
  // on it yet). Either way we invite the user to add the first step.
  const isEmpty = chain.length === 0 || (chain.length === 1 && isBareEnd(chain[0]));
  if (isEmpty) {
    // In a branch lane the fork connector already links the lane to its parent,
    // so the up-rail would be an orphaned stub — show just the CTA.
    if (isLane) {
      return <EmptyLane onAdd={() => onOpenPalette(parentForInsert)} />;
    }
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
      <div className={cn("flex flex-col", ROW_STACK_GAP)}>
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
                stepId={step.id}
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
                branchPathActive={branchPathFocus?.branchStepId === step.id}
                unaccepted={unacceptedIds?.has(step.id)}
                invalidReason={invalidById?.get(step.id)}
                warningReason={warningById?.get(step.id)}
                draggable={!isBranch}
                onClick={() => onClickStep(step.id)}
                onDelete={() => onDeleteStep(step.id)}
                onDuplicate={isBranch ? undefined : () => onDuplicateStep(step.id)}
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
                  warningById={warningById}
                  branchPathFocus={branchPathFocus}
                  activeBranchPath={
                    branchPathFocus?.branchStepId === step.id ? branchPathFocus.key : undefined
                  }
                  onClickStep={onClickStep}
                  onDeleteStep={onDeleteStep}
                  onDuplicateStep={onDuplicateStep}
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
  lineVariant?: "full" | "down" | "down-tail" | "up";
  chipPosition?: "center" | "top";
}) {
  const lineClass =
    lineVariant === "down"
      ? LINE_DOWN
      : lineVariant === "down-tail"
        ? LINE_DOWN_TAIL
        : lineVariant === "up"
          ? LINE_UP
          : LINE_FULL;
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
  variant?: "default" | "trigger" | "muted" | "small";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-border/70 bg-background tabular-nums",
        variant === "trigger" &&
          "size-6 text-[0.625rem] font-medium text-muted-foreground",
        variant === "default" &&
          "size-6 text-[0.625rem] font-medium text-foreground",
        variant === "muted" &&
          "size-6 text-muted-foreground",
        variant === "small" &&
          "size-5 text-[0.625rem] font-medium text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

// ─── Insert row ─────────────────────────────────────────────────────────────

function InsertRow({ onClick }: { onClick: () => void }) {
  return (
    <div className="group/insert relative flex gap-3 py-0.5">
      <RailColumn lineVariant="full" chipPosition="center" />
      <div className={cn("flex items-center justify-center", CARD_W)}>
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] font-medium text-muted-foreground opacity-70 transition-colors hover:bg-muted/40 hover:text-foreground group-hover/insert:opacity-100"
          aria-label="Add step"
          title="Add step"
        >
          <Plus className="size-3.5" aria-hidden />
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
  branchPathActive,
  unaccepted,
  invalidReason,
  warningReason,
  draggable,
  onClick,
  onDelete,
  onDuplicate,
}: {
  step: StepNode;
  ordinal: string;
  selected: boolean;
  /** A Then/Else lane under this branch is focused. */
  branchPathActive?: boolean;
  unaccepted?: boolean;
  /** First validation problem on this step, shown inline. */
  invalidReason?: string;
  /** First non-blocking warning (orphan/cycle), shown in amber when no error. */
  warningReason?: string;
  /** Branch steps are pinned at the chain tail and not reorderable. */
  draggable: boolean;
  onClick: () => void;
  onDelete: () => void;
  /** Duplicate this step (linear steps only; omitted for branches). */
  onDuplicate?: () => void;
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
      data-workflow-step={step.id}
      {...activatorProps}
      className={cn(
        "group/row relative flex gap-3 touch-none",
        draggable && "cursor-grab active:cursor-grabbing",
        sortable.isDragging && "opacity-40",
      )}
    >
      <RailColumn lineVariant="full" chipPosition="center">
        <div
          aria-hidden
          className="relative inline-flex size-6 items-center justify-center rounded-full border border-border/70 bg-background text-[0.625rem] font-medium tabular-nums text-foreground"
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
            <GripVertical className="absolute size-3 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100" />
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
          flowCardTone({
            selected,
            invalid: Boolean(invalidReason),
            unaccepted,
            dragging: sortable.isDragging,
            className: cn(
              "group relative",
              CARD_W,
              branchPathActive && !selected && "ring-2 ring-primary/25",
            ),
          }),
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <StepMeta>{category}</StepMeta>
          <div className="flex shrink-0 items-center gap-0.5">
            {onDuplicate ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate();
                }}
                title="Duplicate step"
                aria-label="Duplicate step"
                className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
              >
                <Copy className="size-3.5" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Remove step"
              aria-label="Remove step"
              className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-start gap-2">
          <SurfaceBadge surface={surface} className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <StepTitle>{step.label || meta?.label || step.type}</StepTitle>
            <StepSummary>{summary}</StepSummary>
            {invalidReason ? (
              <p className="mt-1.5 flex items-center gap-1 text-[0.75rem] font-medium text-destructive">
                <span aria-hidden>▲</span> {invalidReason}
              </p>
            ) : warningReason ? (
              <p className="mt-1.5 flex items-center gap-1 text-[0.75rem] font-medium text-amber-600 dark:text-amber-400">
                <span aria-hidden>▲</span> {warningReason}
              </p>
            ) : null}
          </div>
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
  warningById,
  branchPathFocus,
  activeBranchPath,
  onClickStep,
  onDeleteStep,
  onDuplicateStep,
  onOpenPalette,
}: {
  spec: WorkflowSpec;
  step: StepNode;
  depth: number;
  ordinalMap: Map<string, string>;
  selectedStepId?: string;
  unacceptedIds?: Set<string>;
  invalidById?: Map<string, string>;
  warningById?: Map<string, string>;
  branchPathFocus?: BranchPathFocus | null;
  activeBranchPath?: BranchPathKey;
  onClickStep: (id: string) => void;
  onDeleteStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
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
    // The decision card's rail (LINE_FULL above) bleeds 12px into this row's top,
    // where the connector picks it up. `pl-11` (44px) starts the lanes under the
    // card area; `pt-7` (28px = stem + drop) clears the fork.
    <div className="relative pb-1">
      <BranchConnector ordered={ordered} activeBranchPath={activeBranchPath} />
      {/* items-start so an empty lane stays compact instead of stretching to
          match a filled sibling's height. */}
      <div className="flex items-start gap-4 pt-7 pl-11">
        {ordered.map((label) => {
          const target = branches[label];
          const laneActive = activeBranchPath === label;
          return (
            <div
              key={label}
              data-branch-lane={`${step.id}:${label}`}
              data-branch-lane-active={laneActive ? "" : undefined}
              className={cn(
                "shrink-0 overflow-hidden rounded-md border bg-muted/10 transition-shadow",
                LANE_W,
                laneActive
                  ? label === "true"
                    ? "border-emerald-500/45 bg-emerald-500/[0.04] ring-2 ring-emerald-500/20"
                    : "border-rose-500/45 bg-rose-500/[0.04] ring-2 ring-rose-500/20"
                  : "border-border/50",
              )}
            >
              <BranchHeader label={label} active={laneActive} />
              <div className="p-2">
                <Rail
                  spec={spec}
                  startId={target}
                  parentForInsert={{ parentId: step.id, branch: label }}
                  depth={depth + 1}
                  isLane
                  ordinalMap={ordinalMap}
                  selectedStepId={selectedStepId}
                  unacceptedIds={unacceptedIds}
                  invalidById={invalidById}
                  warningById={warningById}
                  branchPathFocus={branchPathFocus}
                  onClickStep={onClickStep}
                  onDeleteStep={onDeleteStep}
                  onDuplicateStep={onDuplicateStep}
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

// Fork connector between a decision card and its lanes. Anchored to the trunk
// (the rail the decision hangs on) so it reads as the rail forking — not a
// floating stem: a STEM continues the trunk down, a bar reaches across, and one
// DROP per lane lands on that lane's own rail line. Handles any lane count
// (if/else is the common 2); a single lane is just stem → bar → one drop.
function BranchConnector({
  ordered,
  activeBranchPath,
}: {
  ordered: string[];
  activeBranchPath?: BranchPathKey;
}) {
  if (ordered.length === 0) return null;
  const railXs = ordered.map((_, i) => BRANCH_LANE_RAIL_X + BRANCH_LANE_STRIDE * i);
  const lastX = railXs[railXs.length - 1];
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0"
      style={{ height: BRANCH_STEM_H + BRANCH_DROP_H }}
      aria-hidden
    >
      {/* Stem — continues the decision card's rail down to the fork bar. */}
      <span
        className="absolute w-px bg-border/60"
        style={{ left: BRANCH_TRUNK_X, top: 0, height: BRANCH_STEM_H }}
      />
      {/* Bar — reaches from the trunk across to the far lane. */}
      <span
        className="absolute h-px bg-border/60"
        style={{ left: BRANCH_TRUNK_X, top: BRANCH_STEM_H, width: lastX - BRANCH_TRUNK_X }}
      />
      {/* Drops — one per lane, each landing on that lane's own rail. The focused
          lane's drop takes its branch colour to tie the active highlight together. */}
      {ordered.map((label, i) => (
        <span
          key={label}
          className={cn(
            "absolute w-px",
            activeBranchPath === label
              ? label === "true"
                ? "bg-emerald-500/60"
                : label === "false"
                  ? "bg-rose-500/60"
                  : "bg-foreground/40"
              : "bg-border/60",
          )}
          style={{ left: railXs[i], top: BRANCH_STEM_H, height: BRANCH_DROP_H }}
        />
      ))}
    </div>
  );
}

function BranchHeader({ label, active }: { label: string; active?: boolean }) {
  const dot =
    label === "true"
      ? "bg-emerald-500"
      : label === "false"
        ? "bg-rose-500"
        : "bg-muted-foreground";

  const text =
    label === "true"
      ? "Then"
      : label === "false"
        ? "Else"
        : label === "_default"
          ? "Otherwise"
          : label;

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b px-3 py-2",
        active ? "border-border/60 bg-background/40" : "border-border/40",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />
      <span
        className={cn(
          "text-[0.75rem] font-medium",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {text}
      </span>
    </div>
  );
}

// ─── End / empty primitives ────────────────────────────────────────────────

function EndRow() {
  return (
    <div className="relative flex gap-3 py-1">
      <RailColumn lineVariant="up" chipPosition="center">
        <RailChip variant="small">
          <CheckCircle2 className="size-3" aria-hidden />
        </RailChip>
      </RailColumn>
      <div className={cn("flex items-center", CARD_W)}>
        <span className="text-[0.75rem] font-medium text-muted-foreground">End</span>
      </div>
    </div>
  );
}

// A real `control.end` step rendered as the terminal marker. Clickable to edit
// its outcome label, but not deletable from here — a branch lane points at it,
// and dropping it would dangle the branch. Visually mirrors EndRow.
function EndStepRow({
  stepId,
  selected,
  outcome,
  onClick,
}: {
  stepId: string;
  selected: boolean;
  outcome?: string;
  onClick: () => void;
}) {
  return (
    <div className="relative flex gap-3 py-1" data-workflow-step={stepId}>
      <RailColumn lineVariant="up" chipPosition="center">
        <RailChip variant="small">
          <CheckCircle2 className="size-3" aria-hidden />
        </RailChip>
      </RailColumn>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left transition-colors hover:border-border/60 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          CARD_W,
          selected && "border-border/60 bg-muted/20",
        )}
      >
        <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-[0.75rem] font-medium text-muted-foreground">End</span>
        {outcome ? (
          <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
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
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 px-3 py-3 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:border-foreground/15 hover:bg-muted/20 hover:text-foreground"
    >
      <Plus className="size-3.5" aria-hidden />
      Add the first step
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

type PaletteCategory = "common" | Surface;

interface PaletteNavItem {
  id: PaletteCategory;
  title: string;
  count: number;
}

function getCommonSteps(): StepCatalogEntry[] {
  const byId = new Map(STEPS.map((s) => [s.id, s]));
  return COMMON_STEP_IDS.map((id) => byId.get(id)).filter(
    (s): s is StepCatalogEntry => Boolean(s),
  );
}

function searchSteps(query: string): StepCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = STEPS.map((s) => {
    const hay = `${s.label} ${s.id} ${s.description} ${s.examplePrompts.join(" ")}`.toLowerCase();
    if (!hay.includes(q)) return null;
    const label = s.label.toLowerCase();
    const rank = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
    return { s, rank };
  }).filter((x): x is { s: StepCatalogEntry; rank: number } => x !== null);
  scored.sort((a, b) => a.rank - b.rank);
  return scored.map((x) => x.s);
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
  const [activeCategory, setActiveCategory] = useState<PaletteCategory>("common");
  const [activeIndex, setActiveIndex] = useState(0);
  // Only auto-scroll the active row into view when it was moved by the keyboard.
  // Hover-driven changes must never scroll, or the scroll shifts rows under the
  // cursor and triggers another mousemove → active change → scroll feedback loop.
  // State (not a ref) so reading it during render to gate the row effect is safe.
  const [keyboardNav, setKeyboardNav] = useState(false);

  const isSearching = query.trim().length > 0;

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveCategory("common");
      setActiveIndex(0);
      setKeyboardNav(false);
    }
  }, [open]);

  const navItems = useMemo<PaletteNavItem[]>(() => {
    const commonCount = getCommonSteps().length;
    const surfaces = SURFACE_ORDER.map((surface) => ({
      id: surface,
      title: SURFACE_DISPLAY[surface],
      count: STEPS.filter((s) => s.surface === surface).length,
    })).filter((item) => item.count > 0);
    return [{ id: "common", title: "Common", count: commonCount }, ...surfaces];
  }, []);

  const activeNav = navItems.find((item) => item.id === activeCategory) ?? navItems[0];

  const visibleItems = useMemo(() => {
    if (isSearching) return searchSteps(query);
    if (activeCategory === "common") return getCommonSteps();
    return STEPS.filter((s) => s.surface === activeCategory);
  }, [query, activeCategory, isSearching]);

  const safeIndex =
    visibleItems.length === 0 ? 0 : Math.min(activeIndex, visibleItems.length - 1);

  function selectCategory(category: PaletteCategory) {
    setActiveCategory(category);
    setActiveIndex(0);
    setKeyboardNav(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setKeyboardNav(true);
      setActiveIndex(Math.min(safeIndex + 1, visibleItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setKeyboardNav(true);
      setActiveIndex(Math.max(safeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = visibleItems[safeIndex];
      if (pick) onPick(pick.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[min(540px,80vh)] w-full max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:w-[48rem] sm:max-w-[48rem]">
        <DialogHeader className="shrink-0 border-b p-0">
          <DialogTitle className="sr-only">Add a step</DialogTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
                setKeyboardNav(false);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search steps — try “notify”, “summarize”, “if”…"
              autoFocus
              className="h-14 rounded-none border-0 pl-11 pr-4 text-base focus-visible:ring-0"
            />
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav
            aria-label="Step categories"
            aria-hidden={isSearching}
            className={cn(
              "flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-muted/20 p-2",
              isSearching && "invisible pointer-events-none",
            )}
          >
            {navItems.map((item) => (
              <PaletteNavButton
                key={item.id}
                item={item}
                active={activeCategory === item.id}
                onClick={() => selectCategory(item.id)}
              />
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-14 shrink-0 flex-col justify-center border-b px-4">
              <p className="truncate text-base font-medium text-foreground">
                {isSearching ? "Search results" : activeNav?.title ?? "Steps"}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {isSearching
                  ? visibleItems.length === 0
                    ? `No matches for “${query.trim()}”`
                    : `${visibleItems.length} match${visibleItems.length === 1 ? "" : "es"}`
                  : `${visibleItems.length} step${visibleItems.length === 1 ? "" : "s"}`}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {visibleItems.length === 0 ? (
                <p className="px-3 py-12 text-center text-sm text-muted-foreground">
                  {isSearching
                    ? `No steps match “${query.trim()}”.`
                    : "No steps in this category."}
                </p>
              ) : (
                visibleItems.map((entry, idx) => (
                  <PaletteRow
                    key={entry.id}
                    entry={entry}
                    active={idx === safeIndex}
                    showSurface={isSearching || activeCategory === "common"}
                    scrollOnActive={keyboardNav}
                    onHover={() => {
                      setKeyboardNav(false);
                      setActiveIndex(idx);
                    }}
                    onClick={() => onPick(entry.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
          <span><kbd className="font-sans">↑↓</kbd> navigate</span>
          <span><kbd className="font-sans">↵</kbd> add</span>
          <span><kbd className="font-sans">esc</kbd> close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaletteNavButton({
  item,
  active,
  onClick,
}: {
  item: PaletteNavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon =
    item.id === "common" ? LayoutGrid : surfaceMeta(item.id as Surface).icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-[4px]",
          item.id === "common"
            ? "bg-foreground/[0.08] text-foreground/80"
            : surfaceMeta(item.id as Surface).tone,
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
        {item.count}
      </span>
    </button>
  );
}

function PaletteRow({
  entry,
  active,
  showSurface,
  scrollOnActive,
  onHover,
  onClick,
}: {
  entry: StepCatalogEntry;
  active: boolean;
  showSurface: boolean;
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
        "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
        active ? "bg-secondary" : "hover:bg-secondary/60",
      )}
    >
      <SurfaceBadge surface={entry.surface} className="!size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-foreground">{entry.label}</p>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {entry.description}
        </p>
      </div>
      {showSurface ? (
        <SurfaceLabelBadge surface={entry.surface} className="shrink-0" />
      ) : null}
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
