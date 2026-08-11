"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Check, Copy, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SurfaceBadge, SurfaceLabelBadge } from "@/components/workflows/builder/surface-badge";
import { getStep, getTrigger, TRIGGERS } from "@/lib/workflows/catalog";
import type { Surface } from "@/lib/workflows/catalog/types";
import type { WorkflowSpec, StepNode } from "@/lib/workflows/spec";
import { TRIGGER_EVENT_TYPES } from "@/lib/workflows/spec";
import { TRIGGER_NODE_ID } from "@/lib/workflows/graph";
import { STEP_FIELDS } from "@/lib/workflows/field-defs";
import { availableRefs, outputFieldsOf, type RefCandidate } from "@/lib/workflows/refs";
import { AiStepTester } from "@/components/workflows/builder/ai-step-tester";
import { TypedStepForm } from "./typed-step-form";
import { DataContextPanel } from "@/components/workflows/builder/config/data-context-panel";
import { LabelTriggerFilter } from "@/components/workflows/builder/config/label-trigger-filter";
import { FieldTriggerFilter } from "@/components/workflows/builder/config/field-trigger-filter";
import { ScheduleTriggerConfig } from "@/components/workflows/builder/config/schedule-trigger-config";
import { ConditionBuilder } from "@/components/workflows/builder/config/condition-builder";
import { explainTemplateValue } from "@/lib/workflows/explain-template";
import {
  ADDED_LABELS_PATH,
  extractAddedLabelFilter,
  extractFieldTriggerFilter,
  mergeFieldTriggerFilter,
  stripFieldTriggerFilter,
  FIELD_NAME_PATH,
  FIELD_TO_PATH,
  type FieldTriggerSelection,
  explainTriggerFilter,
  mergeTriggerFilter,
  stripAddedLabelFilter,
} from "@/lib/workflows/trigger-filter";
import { isTaskTrigger, suggestedTriggerInput } from "@/lib/workflows/suggested-input";
import { enrichRefsWithPropertyData } from "@/lib/workflows/enrich-refs";
import { useWorkflowBuilderData } from "@/components/workflows/builder/workflow-builder-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TriggerEditorFlowLayout } from "@/components/workflows/builder/trigger-editor-layouts";
import { WorkflowSelect } from "@/components/workflows/builder/workflow-select";
import { StepEditorFlowLayout } from "@/components/workflows/builder/step-editor-flow-layout";
import { InspectorAdvancedSection } from "@/components/workflows/builder/inspector-advanced-section";
import { renameStepId } from "@/lib/workflows/rename-step";
import { JsonEditor } from "@/components/workflows/builder/config/json-editor";
import { explainCondition } from "@/lib/workflows/explain-expr";
import {
  findStepBranchContext,
  getBranchPaths,
  type BranchPathKey,
} from "@/lib/workflows/branch-paths";
import {
  BranchPathContextBar,
  type BranchPathFocus,
} from "@/components/workflows/builder/branch-path-context-bar";

// Right-side non-modal panel that opens when a node is selected.
//
// Organised around the USER, not the data model:
//   • Header — surface badge + an inline-editable step NAME (not the raw id)
//   • "Reads as" — a plain-English summary of what the step does
//   • Body — a friendly typed form, or the condition builder for branch/filter
//   • "Identity & references" — the snake_case step id + {{template}} hint,
//     demoted to a collapsed section at the BOTTOM (it used to open on top)
// Autosaves to the in-memory spec; Esc / ✕ closes (no "Done" footer).

export function NodeInspector({
  spec,
  propertyId,
  selectedNodeId,
  onClose,
  onChange,
  onStepRenamed,
  onConfigureBranchPath,
  branchPathFocus,
  onOpenBranchStep,
  onOpenBranchPath,
  webhookToken,
}: {
  spec: WorkflowSpec;
  propertyId?: string;
  selectedNodeId: string | null;
  onClose: () => void;
  onChange: (next: WorkflowSpec) => void;
  /** Keep canvas/tree selection in sync after an Advanced identifier rename. */
  onStepRenamed?: (newId: string) => void;
  /** Open the true/false lane for a branch step — add steps or jump to the head. */
  onConfigureBranchPath?: (branchStepId: string, branchKey: BranchPathKey) => void;
  branchPathFocus?: BranchPathFocus | null;
  onOpenBranchStep?: (branchStepId: string) => void;
  onOpenBranchPath?: (branchStepId: string, branchKey: BranchPathKey) => void;
  /** Per-workflow webhook token — surfaces the trigger URL for webhook/form. */
  webhookToken?: string | null;
}) {
  const open = selectedNodeId !== null;
  return (
    <NonModalSidePanel open={open} onClose={onClose}>
      {selectedNodeId === TRIGGER_NODE_ID ? (
        <TriggerEditor
          spec={spec}
          propertyId={propertyId}
          onChange={onChange}
          onClose={onClose}
          webhookToken={webhookToken}
        />
      ) : selectedNodeId ? (
        <StepEditor
          spec={spec}
          stepId={selectedNodeId}
          onChange={onChange}
          onClose={onClose}
          onStepRenamed={onStepRenamed}
          onConfigureBranchPath={onConfigureBranchPath}
          branchPathFocus={branchPathFocus}
          onOpenBranchStep={onOpenBranchStep}
          onOpenBranchPath={onOpenBranchPath}
        />
      ) : null}
    </NonModalSidePanel>
  );
}

// Non-modal side panel — slides in from the right but does NOT blur or block
// the rest of the page. The user can keep clicking steps to swap which one is
// being edited. Closes via the X button, Escape, or programmatically.
function NonModalSidePanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <BaseDialog.Root open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <BaseDialog.Portal>
        <BaseDialog.Popup
          data-slot="inspector-panel"
          className={cn(
            "fixed top-0 right-0 z-40 flex h-full w-full max-w-xl flex-col gap-0",
            "bg-popover text-popover-foreground shadow-overlay",
            "transition-transform duration-200 ease-out",
            "data-starting-style:translate-x-full data-ending-style:translate-x-full",
          )}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

// ─── Shared section primitives ──────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-xs font-medium text-faint-foreground">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground/80">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

// ─── Trigger editor ─────────────────────────────────────────────────────────

function TriggerEditor({
  spec,
  propertyId,
  onChange,
  onClose,
  webhookToken,
}: {
  spec: WorkflowSpec;
  propertyId?: string;
  onChange: (next: WorkflowSpec) => void;
  onClose: () => void;
  webhookToken?: string | null;
}) {
  const meta = getTrigger(spec.trigger.event_type);
  const isWebhookTrigger =
    spec.trigger.event_type === "webhook.received" ||
    spec.trigger.event_type === "form.submitted";
  const builderData = useWorkflowBuilderData();
  const refs = useMemo(() => {
    const base = availableRefs(spec);
    return enrichRefsWithPropertyData(base, {
      taskLabels: builderData?.taskLabels,
      channels: builderData?.channels,
    });
  }, [spec, builderData?.taskLabels]);
  const isLabelAdded = spec.trigger.event_type === "task.label_added";
  const isFieldChanged = spec.trigger.event_type === "task.field_changed";
  const isScheduled =
    spec.trigger.event_type === "schedule.cron" ||
    spec.trigger.event_type === "schedule.at_time";
  const filterExpr = spec.trigger.filter?.expr;
  const showOptionalFilters =
    !isScheduled &&
    spec.trigger.event_type !== "manual.run" &&
    (refs.length > 0 || filterExpr != null);

  const selectedLabels = useMemo(
    () => (isLabelAdded ? extractAddedLabelFilter(filterExpr) : []),
    [isLabelAdded, filterExpr],
  );

  const fieldSelection = useMemo(
    () =>
      isFieldChanged
        ? extractFieldTriggerFilter(filterExpr)
        : { fieldName: null, toValue: null },
    [isFieldChanged, filterExpr],
  );

  const summary = useMemo(
    () => explainTriggerFilter(spec.trigger.event_type, filterExpr, meta?.label),
    [spec.trigger.event_type, filterExpr, meta?.label],
  );

  function commitFilter(expr: unknown | undefined) {
    onChange({
      ...spec,
      trigger: {
        ...spec.trigger,
        filter: expr === undefined ? undefined : { expr },
      },
    });
  }

  function commitEventType(next: string) {
    onChange({
      ...spec,
      trigger: { ...spec.trigger, event_type: next as typeof spec.trigger.event_type },
    });
  }

  function commitLabels(labels: string[]) {
    commitFilter(mergeTriggerFilter(labels, stripAddedLabelFilter(filterExpr)));
  }

  function commitFieldSelection(next: FieldTriggerSelection) {
    commitFilter(
      mergeFieldTriggerFilter(next, stripFieldTriggerFilter(filterExpr)),
    );
  }

  function commitAdditional(expr: unknown | undefined) {
    if (isFieldChanged) {
      commitFilter(mergeFieldTriggerFilter(fieldSelection, expr));
      return;
    }
    commitFilter(mergeTriggerFilter(selectedLabels, expr));
  }

  function commitSchedule(schedule: NonNullable<WorkflowSpec["trigger"]["schedule"]>) {
    onChange({
      ...spec,
      trigger: { ...spec.trigger, schedule },
    });
  }

  return (
    <>
      <InspectorHeader
        surface={meta?.surface ?? "system"}
        kind="trigger"
        title={meta?.label ?? spec.trigger.event_type}
        description={meta?.description ?? "Choose what kicks this workflow off."}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <TriggerEditorFlowLayout
          slots={{
            eventSelect: (
              <WorkflowSelect
                ariaLabel="Trigger event"
                value={spec.trigger.event_type}
                onChange={(e) => commitEventType(e.target.value)}
              >
                {TRIGGER_EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGERS.find((x) => x.id === t)?.label ?? t}
                  </option>
                ))}
              </WorkflowSelect>
            ),
            labelFilter: isLabelAdded ? (
              <LabelTriggerFilter
                propertyId={propertyId}
                selected={selectedLabels}
                onChange={commitLabels}
                compact
              />
            ) : null,
            fieldFilter: isFieldChanged ? (
              <FieldTriggerFilter
                propertyId={propertyId}
                selection={fieldSelection}
                onChange={commitFieldSelection}
                compact
              />
            ) : null,
            scheduleConfig: isScheduled ? (
              <ScheduleTriggerConfig trigger={spec.trigger} onChange={commitSchedule} />
            ) : null,
            webhookUrl: isWebhookTrigger ? (
              <WebhookUrlPanel token={webhookToken ?? null} />
            ) : null,
            summary,
            dataContext: <DataContextPanel refs={refs} variant="trigger" />,
            conditions: showOptionalFilters ? (
              <div className="space-y-3">
                <ConditionBuilder
                  variant="trigger"
                  value={
                    isLabelAdded
                      ? stripAddedLabelFilter(filterExpr)
                      : isFieldChanged
                        ? stripFieldTriggerFilter(filterExpr)
                        : filterExpr
                  }
                  refs={refs}
                  onChange={(expr) => {
                    if (isLabelAdded || isFieldChanged) commitAdditional(expr);
                    else commitFilter(expr);
                  }}
                  hidePreview
                  embedded
                  excludePaths={
                    isLabelAdded
                      ? [ADDED_LABELS_PATH]
                      : isFieldChanged
                        ? [FIELD_NAME_PATH, FIELD_TO_PATH]
                        : undefined
                  }
                />
              </div>
            ) : null,
          }}
        />
      </div>
    </>
  );
}

// ─── Step editor ────────────────────────────────────────────────────────────

function StepEditor({
  spec,
  stepId,
  onChange,
  onClose,
  onStepRenamed,
  onConfigureBranchPath,
  branchPathFocus,
  onOpenBranchStep,
  onOpenBranchPath,
}: {
  spec: WorkflowSpec;
  stepId: string;
  onChange: (next: WorkflowSpec) => void;
  onClose: () => void;
  onStepRenamed?: (newId: string) => void;
  onConfigureBranchPath?: (branchStepId: string, branchKey: BranchPathKey) => void;
  branchPathFocus?: BranchPathFocus | null;
  onOpenBranchStep?: (branchStepId: string) => void;
  onOpenBranchPath?: (branchStepId: string, branchKey: BranchPathKey) => void;
}) {
  const step = spec.steps[stepId];
  const meta = useMemo(() => (step ? getStep(step.type) : undefined), [step]);
  const isBranchIf = step?.type === "control.branch_if";
  const isConditional = isBranchIf || step?.type === "control.filter";

  const [draftId, setDraftId] = useState(stepId);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [label, setLabel] = useState(step?.label ?? "");

  useEffect(() => {
    setDraftId(stepId);
    setRenameError(null);
    setLabel(step?.label ?? "");
  }, [stepId, step]);

  const builderData = useWorkflowBuilderData();
  const refs = useMemo(() => {
    const base = availableRefs(spec, stepId);
    if (!isTaskTrigger(spec.trigger.event_type)) return base;
    return enrichRefsWithPropertyData(base, {
      taskLabels: builderData?.taskLabels,
      channels: builderData?.channels,
    });
  }, [spec, stepId, spec.trigger.event_type, builderData?.taskLabels]);
  // Other steps this one can point at — drives the foreach/parallel pickers so
  // users choose a real step instead of free-typing a reference name.
  const stepOptions = useMemo(
    () =>
      Object.entries(spec.steps)
        .filter(([id]) => id !== stepId)
        .map(([id, s]) => ({
          value: id,
          label: (s as { label?: string }).label || getStep(s.type)?.label || id,
        })),
    [spec.steps, stepId],
  );
  const branchPaths = useMemo(
    () => (isBranchIf ? getBranchPaths(spec, stepId) : undefined),
    [isBranchIf, spec, stepId],
  );

  const laneContext = useMemo(() => findStepBranchContext(spec, stepId), [spec, stepId]);
  const pathFocus = useMemo(() => {
    if (branchPathFocus) {
      const onLane =
        branchPathFocus.branchStepId === stepId ||
        laneContext?.branchStepId === branchPathFocus.branchStepId;
      if (onLane) return branchPathFocus;
    }
    if (laneContext) {
      return { branchStepId: laneContext.branchStepId, key: laneContext.branchKey };
    }
    return null;
  }, [branchPathFocus, laneContext, stepId]);

  const branchPathBar = useMemo(() => {
    if (!step) return null;
    if (!pathFocus) return null;
    const branchStep = spec.steps[pathFocus.branchStepId];
    if (!branchStep) return null;
    const branchMeta = getStep(branchStep.type);
    const branchCfg = (branchStep as { config?: { expr?: unknown } }).config;
    const branchTitle =
      branchStep.label?.trim() || branchMeta?.label || "Branch (if/else)";
    const conditionSummary = explainCondition(branchCfg?.expr);
    const pathLabel = pathFocus.key === "true" ? "Then" : "Else";
    const currentStepTitle =
      stepId !== pathFocus.branchStepId
        ? label.trim() || meta?.label || stepId
        : null;

    return (
      <BranchPathContextBar
        branchTitle={branchTitle}
        conditionSummary={conditionSummary}
        pathLabel={pathLabel}
        currentStepTitle={currentStepTitle}
        onOpenBranch={() => onOpenBranchStep?.(pathFocus.branchStepId)}
        onOpenPath={
          onOpenBranchPath
            ? () => onOpenBranchPath(pathFocus.branchStepId, pathFocus.key)
            : undefined
        }
      />
    );
  }, [
    step,
    pathFocus,
    spec,
    stepId,
    label,
    meta?.label,
    onOpenBranchStep,
    onOpenBranchPath,
  ]);

  if (!step) return null;

  function commitLabel() {
    if (!step) return;
    onChange({
      ...spec,
      steps: { ...spec.steps, [stepId]: { ...step, label } as StepNode },
    });
  }

  function commitConfig(config: unknown) {
    if (!step) return;
    onChange({
      ...spec,
      steps: { ...spec.steps, [stepId]: { ...step, config } as StepNode },
    });
  }

  // Merge a patch into top-level step fields (retry, on_error, …) — distinct
  // from commitConfig, which only touches step.config.
  function commitStepPatch(patch: Record<string, unknown>) {
    if (!step) return;
    onChange({
      ...spec,
      steps: { ...spec.steps, [stepId]: { ...step, ...patch } as StepNode },
    });
  }

  function commitRename() {
    if (!step) return;
    if (draftId === stepId || !draftId) {
      setRenameError(null);
      return;
    }
    const nextSpec = renameStepId(spec, stepId, draftId);
    if (!nextSpec) {
      setRenameError(
        spec.steps[draftId]
          ? `Identifier "${draftId}" is already in use`
          : "Could not rename this step",
      );
      setDraftId(stepId);
      return;
    }
    setRenameError(null);
    onChange(nextSpec);
    onStepRenamed?.(draftId);
  }

  const cfg = (step as { config?: unknown }).config ?? {};
  const cfgRecord = cfg as Record<string, unknown>;
  const readsAs = meta?.explain(cfg);
  const inputHint =
    !isConditional && "input" in cfgRecord
      ? explainTemplateValue((cfgRecord as { input?: string }).input, refs)
      : null;
  const isFilter = step.type === "control.filter";
  const filterExpr = (cfgRecord as { expr?: unknown }).expr;
  const filterSummary =
    isFilter && filterExpr === undefined
      ? "No conditions yet — this step will always continue."
      : isFilter
        ? explainCondition(filterExpr)
        : null;

  const hasFormFields = Boolean(STEP_FIELDS[step.type as keyof typeof STEP_FIELDS]);
  const producedFields = outputFieldsOf(meta?.outputSchema);

  const activeBranchPath =
    isBranchIf && branchPathFocus?.branchStepId === stepId
      ? branchPathFocus.key
      : undefined;

  function onJsonConfigChange(next: unknown) {
    if (next && typeof next === "object" && !Array.isArray(next)) {
      commitConfig(next as Record<string, unknown>);
    } else {
      commitConfig({});
    }
  }

  return (
    <>
      {branchPathBar}
      <InspectorHeader
        surface={meta?.surface ?? "system"}
        kind={
          meta?.category === "ai"
            ? "ai"
            : meta?.category === "control"
              ? "logic"
              : "action"
        }
        title={label}
        titleResetKey={stepId}
        titlePlaceholder={meta?.label ?? step.type}
        onTitleChange={setLabel}
        onTitleCommit={commitLabel}
        description={meta?.description ?? ""}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <StepEditorFlowLayout
          slots={{
            mode: isFilter ? "filter" : isBranchIf ? "branch" : "action",
            canvasSummary:
              !isConditional && readsAs ? (
                <p className="text-sm leading-relaxed text-foreground/90">{readsAs}</p>
              ) : undefined,
            configure: isConditional ? undefined : (
              <>
                <StepConfigSection
                  stepType={step.type}
                  stepId={stepId}
                  triggerEventType={spec.trigger.event_type}
                  value={cfgRecord}
                  onChange={commitConfig}
                  refs={refs}
                  stepOptions={stepOptions}
                  explainHint={meta?.explain(cfg)}
                  inputHint={inputHint}
                  embedded
                />
                {step.type.startsWith("ai.") ? (
                  <AiStepTester stepType={step.type} config={cfgRecord} spec={spec} />
                ) : null}
              </>
            ),
            dataContext:
              !isConditional && refs.length > 0 ? (
                <DataContextPanel refs={refs} variant="step" />
              ) : undefined,
            produces:
              !isConditional && producedFields.length > 0 ? (
                <StepProducesPanel stepId={stepId} fields={producedFields} />
              ) : undefined,
            condition: isFilter ? (
              <ConditionBuilder
                variant="filter"
                value={filterExpr}
                refs={refs}
                onChange={(expr) => commitConfig({ ...cfgRecord, expr })}
                hidePreview
                embedded
              />
            ) : undefined,
            branchCondition: isBranchIf ? (
              <ConditionBuilder
                variant="branch"
                part="conditions"
                value={filterExpr}
                refs={refs}
                onChange={(expr) => commitConfig({ ...cfgRecord, expr })}
                hidePreview
                embedded
              />
            ) : undefined,
            branchPaths: isBranchIf ? (
              <ConditionBuilder
                variant="branch"
                part="paths"
                value={filterExpr}
                refs={refs}
                onChange={(expr) => commitConfig({ ...cfgRecord, expr })}
                branchPaths={branchPaths}
                onConfigureBranchPath={
                  onConfigureBranchPath
                    ? (key) => onConfigureBranchPath(stepId, key)
                    : undefined
                }
                activeBranchPath={activeBranchPath}
              />
            ) : undefined,
            conditionSummary: isFilter ? (
              <p className="text-sm leading-relaxed text-foreground/90">
                {filterSummary}
              </p>
            ) : undefined,
            advanced: (
              <div className="space-y-4">
                {(step.type.startsWith("action.") || step.type.startsWith("ai.")) && (
                  <StepErrorHandling step={step} onPatch={commitStepPatch} />
                )}
                <InspectorAdvancedSection
                  draftId={draftId}
                  onDraftIdChange={setDraftId}
                  onDraftIdCommit={commitRename}
                  renameError={renameError}
                  refs={refs}
                  spec={spec}
                  stepId={stepId}
                  rawJson={
                  isConditional
                    ? {
                        value: cfgRecord,
                        onChange: onJsonConfigChange,
                        hint: "For power users — the raw condition and any extra settings. The visual builder above is the easier way; only edit here if you need something it can’t express.",
                        validateExpr: true,
                        showFieldCatalog: true,
                        fieldCatalogMode: "condition",
                      }
                    : hasFormFields
                      ? {
                          value: cfgRecord,
                          onChange: onJsonConfigChange,
                          hint: "For power users — the raw settings. The fields above cover almost everything.",
                          showFieldCatalog: false,
                        }
                      : undefined
                  }
                />
              </div>
            ),
          }}
        />
      </div>
    </>
  );
}

// ─── Webhook URL panel (webhook/form triggers) ─────────────────────────────

function WebhookUrlPanel({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!token) {
    return (
      <p className="text-sm text-muted-foreground">
        Save the workflow to generate its webhook URL.
      </p>
    );
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/api/workflows/webhook/${token}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate text-xs text-foreground">{url}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        POST here (JSON or form data) to run this workflow. The posted body is
        available to later steps as <code className="text-foreground/80">{"{{trigger.…}}"}</code>.
        Turn the workflow on for it to fire.
      </p>
    </div>
  );
}

// ─── Error handling (retry + on-error) ─────────────────────────────────────
// Surfaces the per-step retry / on_error settings the runtime already honors,
// in plain language. Branch-on-error stays in the raw settings — the friendly
// control covers the two common choices (stop vs continue).

function StepErrorHandling({
  step,
  onPatch,
}: {
  step: StepNode;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const maxRetries = (step as { retry?: { max?: number } }).retry?.max ?? 0;
  const onError = (step as { on_error?: string }).on_error ?? "fail";
  const errorMode: "fail" | "continue" = onError === "continue" ? "continue" : "fail";

  function setRetries(n: number) {
    const clamped = Math.max(0, Math.min(10, Math.floor(Number.isFinite(n) ? n : 0)));
    onPatch({ retry: clamped > 0 ? { max: clamped, backoff: "exp", initial_ms: 1000 } : undefined });
  }

  function setErrorMode(mode: "fail" | "continue") {
    onPatch({ on_error: mode === "continue" ? "continue" : "fail" });
  }

  return (
    <div className="space-y-3 rounded-lg bg-muted/[0.04] p-3">
      <p className="text-sm font-medium text-foreground">If this step fails</p>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-faint-foreground">
          Retry first
        </span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={10}
            value={maxRetries}
            onChange={(e) => setRetries(Number(e.target.value))}
            aria-label="Retry attempts"
            className="h-9 w-20 rounded-md bg-background px-2 text-sm"
          />
          <span className="text-sm text-muted-foreground">
            {maxRetries === 0
              ? "no retries"
              : `${maxRetries === 1 ? "time" : "times"} before giving up`}
          </span>
        </div>
      </label>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-faint-foreground">
          Then
        </span>
        <WorkflowSelect
          ariaLabel="On error"
          value={errorMode}
          onChange={(e) => setErrorMode(e.target.value as "fail" | "continue")}
        >
          <option value="fail">Stop the workflow</option>
          <option value="continue">Skip this step and keep going</option>
        </WorkflowSelect>
      </label>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Retries wait a little longer between each attempt. To send the workflow
        to a specific step on failure, use the raw settings below.
      </p>
    </div>
  );
}

// ─── Step config section (typed form + advanced JSON fallback) ─────────────

/**
 * The step's output contract — which fields later steps can reference. Shown
 * for every action/AI step so authors learn what a step yields without
 * opening a downstream step's data picker first.
 */
function StepProducesPanel({
  stepId,
  fields,
}: {
  stepId: string;
  fields: Array<{ key: string; type: string }>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {fields.map((f) => (
          <Badge
            key={f.key}
            variant="outline"
            className="gap-1.5 border-border bg-muted font-mono"
          >
            {f.key}
            <span className="font-sans text-xs text-muted-foreground">{f.type}</span>
          </Badge>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Later steps can use {fields.length === 1 ? "this" : "these"} via{" "}
        <span className="font-medium text-foreground/80">Insert data</span> — e.g.{" "}
        <code className="rounded-md bg-muted px-1 py-px font-mono text-xs">
          {`{{steps.${stepId}.output.${fields[0]!.key}}}`}
        </code>
        .
      </p>
    </div>
  );
}

function StepConfigSection({
  stepType,
  stepId,
  triggerEventType,
  value,
  onChange,
  refs,
  stepOptions,
  explainHint,
  inputHint,
  embedded = false,
}: {
  stepType: string;
  stepId: string;
  triggerEventType: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  refs: RefCandidate[];
  /** Other step ids (id + label) for foreach/parallel step pickers. */
  stepOptions?: { value: string; label: string }[];
  explainHint?: string;
  /** Shown when the primary `input` field is empty — nudges toward trigger data. */
  inputHint?: string | null;
  /** Inside the flow rail — no section chrome; raw JSON lives in Advanced step. */
  embedded?: boolean;
}) {
  const builderData = useWorkflowBuilderData();
  const fields = STEP_FIELDS[stepType as keyof typeof STEP_FIELDS];

  const onJsonChange = (next: unknown) => {
    if (next && typeof next === "object" && !Array.isArray(next)) {
      onChange(next as Record<string, unknown>);
    } else {
      onChange({});
    }
  };

  if (!fields) {
    const editor = (
      <JsonEditor value={value} onChange={onJsonChange} hint={explainHint} />
    );
    if (embedded) return editor;
    return (
      <Section
        title="Configuration"
        description="No friendly form yet for this step type — edit raw JSON."
      >
        {editor}
      </Section>
    );
  }

  // Nag about a missing `input` only when the step actually REQUIRES one
  // (summarize/classify/extract/draft). On ai.freeform input is optional data
  // alongside the instructions — an amber "this step needs text" banner there
  // would be wrong.
  const inputRequired = fields.some(
    (f) => f.key === "input" && "required" in f && f.required === true,
  );
  const inputEmpty =
    inputRequired &&
    (value.input === undefined || value.input === "" || value.input === null);
  const inputSuggestion = suggestedTriggerInput(triggerEventType);

  function applySuggestedInput() {
    if (!inputSuggestion) return;
    onChange({ ...value, input: `{{${inputSuggestion.path}}}` });
  }

  const body = (
    <div className="space-y-3">
      {inputEmpty && stepType.startsWith("ai.") && inputSuggestion && (
        <div className="flex flex-col gap-2 rounded-md bg-warning/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-relaxed text-foreground/85">
            This step needs text to work on. For task workflows, the complaint or
            details usually live in the task{" "}
            <span className="font-medium">description</span>.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={applySuggestedInput}
          >
            {inputSuggestion.buttonLabel}
          </Button>
        </div>
      )}
      {inputEmpty && stepType.startsWith("ai.") && !inputSuggestion && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm leading-relaxed text-foreground/85">
          Choose what text the AI should read — use{" "}
          <span className="font-medium">Insert data</span> on the field below.
        </p>
      )}
      {inputHint && !inputEmpty && stepType.startsWith("ai.") && (
        <p className="text-sm text-muted-foreground">
          Currently using: <span className="font-medium text-foreground">{inputHint}</span>
        </p>
      )}
      <TypedStepForm
        fields={fields}
        value={value}
        onChange={onChange}
        refs={refs}
        stepOptions={stepOptions}
        channels={builderData?.channels ?? []}
        channelsLoading={builderData?.channelsLoading}
        members={builderData?.members ?? []}
        membersLoading={builderData?.membersLoading}
        triggerEventType={triggerEventType}
        formKey={stepId}
      />
    </div>
  );

  if (embedded) return body;
  return <Section title="Set up this step">{body}</Section>;
}

// ─── Header ──────────────────────────────────────────────────────────────────

type InspectorKind = "trigger" | "action" | "ai" | "logic";

const INSPECTOR_KIND_LABEL: Record<InspectorKind, string> = {
  trigger: "Trigger",
  action: "Action",
  ai: "AI action",
  logic: "Logic",
};

function InspectorHeader({
  surface,
  kind,
  title,
  description,
  titleResetKey,
  titlePlaceholder,
  onTitleChange,
  onTitleCommit,
  onClose,
}: {
  surface: Surface;
  kind: InspectorKind;
  title: string;
  description: string;
  /** Resets rename mode when the selected step changes. */
  titleResetKey?: string;
  /** Catalog label shown when the step has no custom name. */
  titlePlaceholder?: string;
  onTitleChange?: (next: string) => void;
  onTitleCommit?: () => void;
  onClose: () => void;
}) {
  const kindLabel = INSPECTOR_KIND_LABEL[kind];
  const editable = Boolean(onTitleChange);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedTitleRef = useRef(title);

  const displayTitle = title.trim() || titlePlaceholder || "Untitled step";
  const usingDefaultName = editable && !title.trim();

  useEffect(() => {
    setRenaming(false);
  }, [titleResetKey]);

  useEffect(() => {
    if (!renaming) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [renaming]);

  function startRenaming() {
    if (!editable) return;
    savedTitleRef.current = title;
    setRenaming(true);
  }

  function commitRename() {
    onTitleCommit?.();
    setRenaming(false);
  }

  function cancelRename() {
    onTitleChange?.(savedTitleRef.current);
    setRenaming(false);
  }

  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <SurfaceBadge surface={surface} className="mt-0.5 size-9 rounded-lg" />

        <div className="min-w-0 flex-1">
          {editable && renaming ? (
            <input
              ref={inputRef}
              value={title}
              onChange={(e) => onTitleChange?.(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              placeholder={titlePlaceholder}
              aria-label="Step name"
              className="w-full rounded-md bg-background px-2 py-1 text-base font-semibold text-foreground outline-none focus-visible:shadow-focus"
            />
          ) : (
            <div className="group/title flex items-start gap-1">
              <h2
                className={cn(
                  "min-w-0 flex-1 text-base font-semibold text-balance",
                  usingDefaultName ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {displayTitle}
              </h2>
              {editable ? (
                <button
                  type="button"
                  onClick={startRenaming}
                  aria-label="Rename step"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent group-hover/title:text-muted-foreground"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          )}

          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground/75">{kindLabel}</span>
            <SurfaceLabelBadge surface={surface} />
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent"
        >
          <X className="size-4" />
        </button>
      </div>

      {description ? (
        <div className="border-t border-border bg-muted px-4 py-3">
          <p className="max-w-[56ch] text-sm text-pretty text-muted-foreground">{description}</p>
        </div>
      ) : null}
    </header>
  );
}
