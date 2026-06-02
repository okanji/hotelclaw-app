"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupRefs, type RefCandidate, type RefType } from "@/lib/workflows/refs";
import {
  emptyClause,
  emptyGroup,
  opsForType,
  parseCondition,
  serializeCondition,
  type Clause,
  type ClauseOp,
  type CondNode,
  type ConditionModel,
} from "@/lib/workflows/jsonlogic-codec";
import { explainCondition } from "@/lib/workflows/explain-expr";
import type { BranchPathInfo, BranchPathKey } from "@/lib/workflows/branch-paths";
import { WorkflowSelect } from "@/components/workflows/builder/workflow-select";

// Plain-English condition builder. Edits a flat ALL/ANY list of Field·Op·Value
// rows. Everything the user touches is a picker — fields, operators, and (where
// the field has known values) the value itself auto-populate as dropdowns or
// chips, so nobody ever types a magic string or sees JSON.

function humanizeOption(token: string): string {
  const words = token.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function enrichTypes(model: ConditionModel, refs: RefCandidate[]): ConditionModel {
  return { ...model, clauses: enrichNodes(model.clauses, refs) };
}

function enrichNodes(nodes: CondNode[], refs: RefCandidate[]): CondNode[] {
  return nodes.map((n) => {
    if (n.kind === "group") return { ...n, clauses: enrichNodes(n.clauses, refs) };
    const ref = refs.find((r) => r.path === n.path);
    return ref ? { ...n, type: ref.type } : n;
  });
}

// ─── Path-addressed, immutable tree edits ────────────────────────────────────
// A path is an array of child indices from the root, e.g. [1, 0] = the first
// child of the root's second node (a group).

function mapNodeAt(
  nodes: CondNode[],
  path: number[],
  fn: (n: CondNode) => CondNode | null,
): CondNode[] {
  const [idx, ...rest] = path;
  const out: CondNode[] = [];
  nodes.forEach((n, i) => {
    if (i !== idx) {
      out.push(n);
      return;
    }
    if (rest.length === 0) {
      const next = fn(n);
      if (next) out.push(next);
    } else if (n.kind === "group") {
      out.push({ ...n, clauses: mapNodeAt(n.clauses, rest, fn) });
    } else {
      out.push(n);
    }
  });
  return out;
}

function appendToGroup(nodes: CondNode[], parentPath: number[], node: CondNode): CondNode[] {
  if (parentPath.length === 0) return [...nodes, node];
  const [idx, ...rest] = parentPath;
  return nodes.map((n, i) =>
    i === idx && n.kind === "group" ? { ...n, clauses: appendToGroup(n.clauses, rest, node) } : n,
  );
}

export type ConditionBuilderVariant = "branch" | "filter" | "trigger" | "generic";

export type ConditionBuilderPart = "all" | "conditions" | "paths";

export function ConditionBuilder({
  value,
  onChange,
  refs,
  variant = "generic",
  branchPaths,
  onConfigureBranchPath,
  activeBranchPath,
  hidePreview = false,
  embedded = false,
  excludePaths,
  part = "all",
}: {
  value: unknown;
  onChange: (expr: unknown | undefined) => void;
  refs: RefCandidate[];
  variant?: ConditionBuilderVariant;
  /** True/false lane summaries — only for branch variant. */
  branchPaths?: BranchPathInfo[];
  onConfigureBranchPath?: (key: BranchPathKey) => void;
  /** Highlights and nests the lane the user chose in the inspector. */
  activeBranchPath?: BranchPathKey;
  /** Parent shows the summary (e.g. trigger label picker + live line). */
  hidePreview?: boolean;
  /** Flatter rows — no nested cards per condition. */
  embedded?: boolean;
  /** Field paths hidden from the field picker (handled elsewhere). */
  excludePaths?: string[];
  /** Branch inspector: edit conditions and paths on separate flow steps. */
  part?: ConditionBuilderPart;
}) {
  const refsRef = useRef(refs);
  useEffect(() => {
    refsRef.current = refs;
  });

  const [model, setModel] = useState<ConditionModel>(() => {
    const parsed = parseCondition(value);
    return parsed ? enrichTypes(parsed, refs) : { combine: "all", clauses: [] };
  });
  const [advanced, setAdvanced] = useState(
    value !== undefined && parseCondition(value) === null,
  );

  const lastEmitted = useRef<string>(JSON.stringify(value ?? null));

  useEffect(() => {
    const incoming = JSON.stringify(value ?? null);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    const parsed = parseCondition(value);
    if (parsed) {
      setModel(enrichTypes(parsed, refsRef.current));
      setAdvanced(false);
    } else if (value !== undefined) {
      setAdvanced(true);
    }
  }, [value]);

  function update(next: ConditionModel) {
    setModel(next);
    const expr = serializeCondition(next);
    lastEmitted.current = JSON.stringify(expr ?? null);
    onChange(expr);
  }

  function patchClause(path: number[], patch: Partial<Clause>) {
    update({
      ...model,
      clauses: mapNodeAt(model.clauses, path, (n) =>
        n.kind === "clause" ? { ...n, ...patch } : n,
      ),
    });
  }

  function setGroupCombine(path: number[], combine: "all" | "any") {
    update({
      ...model,
      clauses: mapNodeAt(model.clauses, path, (n) =>
        n.kind === "group" ? { ...n, combine } : n,
      ),
    });
  }

  function removeNode(path: number[]) {
    update({ ...model, clauses: mapNodeAt(model.clauses, path, () => null) });
  }

  function addNode(parentPath: number[], node: CondNode) {
    update({ ...model, clauses: appendToGroup(model.clauses, parentPath, node) });
  }

  // Root-level convenience adders.
  const addClause = () => addNode([], emptyClause());
  const addGroup = () => addNode([], emptyGroup());

  function rebuildFromScratch() {
    setAdvanced(false);
    update({ combine: "all", clauses: [] });
  }

  const readsAs = useMemo(() => {
    const expr = serializeCondition(model);
    return expr === undefined ? null : explainCondition(expr);
  }, [model]);

  const visibleRefs = useMemo(
    () =>
      excludePaths?.length
        ? refs.filter((r) => !excludePaths.includes(r.path))
        : refs,
    [refs, excludePaths],
  );

  if (advanced) {
    return (
      <div className="space-y-4 rounded-xl border border-border/70 bg-muted/15 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
            <Wand2 className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Custom condition</p>
            <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              This condition is too advanced for the simple editor, so it’s shown read-only.
              It still works — leave it as-is, or start over to build a new one by hand.
            </p>
          </div>
        </div>
        <p className="rounded-lg border border-border/60 bg-background px-3.5 py-3 text-sm leading-relaxed text-foreground/90">
          {explainCondition(value)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={rebuildFromScratch}>
          <Wand2 className="size-3.5" aria-hidden />
          Clear and start over
        </Button>
      </div>
    );
  }

  const hasClauses = model.clauses.length > 0;
  const multi = model.clauses.length > 1;

  const branchPathsOnly = variant === "branch" && part === "paths";
  const branchConditionsOnly = variant === "branch" && part === "conditions";

  if (branchPathsOnly) {
    return (
      <BranchPathsPanel
        readsAs={readsAs}
        hasClauses={hasClauses}
        branchPaths={branchPaths}
        onConfigureBranchPath={onConfigureBranchPath}
        activeBranchPath={activeBranchPath}
      />
    );
  }

  const nodeHandlers = {
    refs: visibleRefs,
    embedded: embedded || branchConditionsOnly,
    onPatchClause: patchClause,
    onSetGroupCombine: setGroupCombine,
    onRemove: removeNode,
    onAdd: addNode,
  };

  const conditionEditor = (
    <>
      {multi && (
        <CombineBar
          combine={model.combine}
          onChange={(combine) => update({ ...model, combine })}
        />
      )}

      {hasClauses ? (
        <NodeList nodes={model.clauses} combine={model.combine} path={[]} {...nodeHandlers} />
      ) : (
        <EmptyConditions variant={variant} canAdd={variant !== "trigger" || refs.length > 0} onAdd={addClause} />
      )}

      {hasClauses && (variant !== "trigger" || refs.length > 0) && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addClause}
            className="flex-1 border-dashed text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="size-3.5" aria-hidden />
            Add condition
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addGroup}
            title="Add a nested group with its own And/Or — e.g. urgent AND (todo OR blocked)"
            className="border-dashed text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="size-3.5" aria-hidden />
            Add group
          </Button>
        </div>
      )}
    </>
  );

  const preview =
    !hidePreview && !branchConditionsOnly ? (
      <DecisionPreview
        variant={variant}
        readsAs={readsAs}
        hasClauses={hasClauses}
        branchPaths={variant === "branch" && !hasClauses ? undefined : branchPaths}
        onConfigureBranchPath={
          variant === "branch" && !hasClauses ? undefined : onConfigureBranchPath
        }
      />
    ) : null;

  const branchOrder = variant === "branch" && part === "all";

  return (
    <div className={embedded || branchConditionsOnly ? "space-y-3" : "space-y-4"}>
      {branchOrder ? (
        <>
          {conditionEditor}
          {preview}
        </>
      ) : (
        <>
          {preview}
          {conditionEditor}
        </>
      )}
    </div>
  );
}

// ─── Branch paths (step 2 — after conditions) ────────────────────────────────

function BranchPathsPanel({
  readsAs,
  hasClauses,
  branchPaths,
  onConfigureBranchPath,
  activeBranchPath,
}: {
  readsAs: string | null;
  hasClauses: boolean;
  branchPaths?: BranchPathInfo[];
  onConfigureBranchPath?: (key: BranchPathKey) => void;
  activeBranchPath?: BranchPathKey;
}) {
  if (!hasClauses) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-3 py-4 text-center">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          Add a condition above first — then you can set what runs on{" "}
          <span className="font-medium text-foreground/80">Then</span> vs{" "}
          <span className="font-medium text-foreground/80">Else</span>.
        </p>
      </div>
    );
  }

  return (
    <BranchDecisionCard
      readsAs={readsAs}
      branchPaths={branchPaths}
      onConfigureBranchPath={onConfigureBranchPath}
      activeBranchPath={activeBranchPath}
    />
  );
}

function BranchDecisionCard({
  readsAs,
  branchPaths,
  onConfigureBranchPath,
  activeBranchPath,
}: {
  readsAs: string | null;
  branchPaths?: BranchPathInfo[];
  onConfigureBranchPath?: (key: BranchPathKey) => void;
  activeBranchPath?: BranchPathKey;
}) {
  const truePath = branchPaths?.find((p) => p.key === "true");
  const falsePath = branchPaths?.find((p) => p.key === "false");
  const activePath =
    activeBranchPath === "true" ? truePath : activeBranchPath === "false" ? falsePath : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
        <span className="mt-0.5 shrink-0 rounded-md bg-foreground/10 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider text-foreground/70">
          If
        </span>
        <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-foreground">
          {readsAs ?? "Condition is set"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PathChip
          tone="true"
          label="Then"
          detail={truePath?.preview ?? "True path runs"}
          empty={truePath?.isEmpty}
          active={activeBranchPath === "true"}
          onClick={
            onConfigureBranchPath ? () => onConfigureBranchPath("true") : undefined
          }
        />
        <PathChip
          tone="false"
          label="Else"
          detail={falsePath?.preview ?? "False path runs"}
          empty={falsePath?.isEmpty}
          active={activeBranchPath === "false"}
          onClick={
            onConfigureBranchPath ? () => onConfigureBranchPath("false") : undefined
          }
        />
      </div>
      {activePath && activeBranchPath ? (
        <BranchPathNestedPanel
          pathKey={activeBranchPath}
          path={activePath}
          onConfigure={onConfigureBranchPath}
        />
      ) : onConfigureBranchPath ? (
        <p className="text-center text-[0.6875rem] text-muted-foreground/80">
          Click a path to add or edit its steps on the canvas
        </p>
      ) : null}
    </div>
  );
}

function BranchPathNestedPanel({
  pathKey,
  path,
  onConfigure,
}: {
  pathKey: BranchPathKey;
  path: BranchPathInfo;
  onConfigure?: (key: BranchPathKey) => void;
}) {
  const isTrue = pathKey === "true";
  const label = isTrue ? "Then" : "Else";

  return (
    <div
      className={cn(
        "relative ml-2 space-y-2 border-l-2 py-1 pl-4",
        isTrue ? "border-emerald-500/50" : "border-rose-500/50",
      )}
    >
      <p
        className={cn(
          "text-[0.6875rem] font-semibold uppercase tracking-[0.08em]",
          isTrue ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
        )}
      >
        {label} path
      </p>
      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
        {path.isEmpty
          ? "No steps yet — add the first step on the canvas lane below."
          : path.stepCount === 1
            ? `Runs: ${path.preview}`
            : `${path.stepCount} steps — starts with ${path.preview}`}
      </p>
      {onConfigure ? (
        <button
          type="button"
          onClick={() => onConfigure(pathKey)}
          className={cn(
            "text-[0.75rem] font-medium underline-offset-2 hover:underline",
            isTrue ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
          )}
        >
          {path.isEmpty ? "Add step on canvas" : "View on canvas"}
        </button>
      ) : null}
    </div>
  );
}

// ─── Live decision preview ───────────────────────────────────────────────────

function DecisionPreview({
  variant,
  readsAs,
  hasClauses,
  branchPaths,
  onConfigureBranchPath,
}: {
  variant: ConditionBuilderVariant;
  readsAs: string | null;
  hasClauses: boolean;
  branchPaths?: BranchPathInfo[];
  onConfigureBranchPath?: (key: BranchPathKey) => void;
}) {
  if (variant === "branch") {
    if (!hasClauses) return null;
    return (
      <BranchDecisionCard
        readsAs={readsAs}
        branchPaths={branchPaths}
        onConfigureBranchPath={onConfigureBranchPath}
      />
    );
  }

  if (variant === "filter" || variant === "trigger") {
    const title = variant === "trigger" ? "Only run when" : "Continue only when";
    const empty =
      variant === "trigger"
        ? "Every matching event (no extra filter)"
        : "Always continues (no filter)";

    return (
      <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </p>
        <p
          className={cn(
            "mt-1 text-[0.8125rem] leading-relaxed",
            hasClauses && readsAs ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {hasClauses && readsAs ? readsAs : empty}
        </p>
      </div>
    );
  }

  if (!readsAs) return null;

  return (
    <div className="rounded-xl border border-primary/15 bg-primary/[0.04] px-3.5 py-3">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Summary
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{readsAs}</p>
    </div>
  );
}

function PathChip({
  tone,
  label,
  detail,
  empty,
  active,
  onClick,
}: {
  tone: "true" | "false";
  label: string;
  detail: string;
  empty?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const isTrue = tone === "true";
  const interactive = !!onClick;

  const body = (
    <>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isTrue ? "bg-emerald-500" : "bg-rose-500",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 text-left">
        <p
          className={cn(
            "text-[0.6875rem] font-semibold uppercase tracking-[0.08em]",
            isTrue ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
          )}
        >
          {label}
        </p>
        <p
          className={cn(
            "truncate text-[0.75rem]",
            empty ? "text-muted-foreground/70 italic" : "text-muted-foreground",
          )}
        >
          {detail}
        </p>
      </div>
      <ArrowRight
        className={cn(
          "size-3.5 shrink-0 transition-transform",
          interactive && "opacity-70 group-hover:translate-x-0.5 group-hover:opacity-100",
          !interactive && "opacity-50",
          isTrue ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
        )}
        aria-hidden
      />
    </>
  );

  const className = cn(
    "group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left transition-colors",
    isTrue
      ? "border-emerald-500/25 bg-emerald-500/[0.06]"
      : "border-rose-500/25 bg-rose-500/[0.06]",
    active &&
      (isTrue
        ? "ring-2 ring-emerald-500/35 border-emerald-500/50 bg-emerald-500/10"
        : "ring-2 ring-rose-500/35 border-rose-500/50 bg-rose-500/10"),
    interactive &&
      "cursor-pointer hover:border-opacity-60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    interactive &&
      !active &&
      (isTrue
        ? "hover:bg-emerald-500/10 hover:border-emerald-500/40"
        : "hover:bg-rose-500/10 hover:border-rose-500/40"),
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}

// ─── Recursive node renderer (clauses + nested groups) ───────────────────────

type NodeHandlers = {
  refs: RefCandidate[];
  embedded: boolean;
  onPatchClause: (path: number[], patch: Partial<Clause>) => void;
  onSetGroupCombine: (path: number[], combine: "all" | "any") => void;
  onRemove: (path: number[]) => void;
  onAdd: (parentPath: number[], node: CondNode) => void;
};

function NodeList({
  nodes,
  combine,
  path,
  ...handlers
}: { nodes: CondNode[]; combine: "all" | "any"; path: number[] } & NodeHandlers) {
  return (
    <ul role="list" className="space-y-0">
      {nodes.map((node, i) => {
        const nodePath = [...path, i];
        return (
          <li key={i}>
            {i > 0 && <LogicConnector combine={combine} />}
            {node.kind === "group" ? (
              <GroupCard group={node} path={nodePath} {...handlers} />
            ) : (
              <ClauseCard
                index={i}
                clause={node}
                refs={handlers.refs}
                embedded={handlers.embedded}
                onChange={(patch) => handlers.onPatchClause(nodePath, patch)}
                onRemove={() => handlers.onRemove(nodePath)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GroupCard({
  group,
  path,
  ...handlers
}: { group: Extract<CondNode, { kind: "group" }>; path: number[] } & NodeHandlers) {
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
          {(["all", "any"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => handlers.onSetGroupCombine(path, opt)}
              aria-pressed={group.combine === opt}
              className={cn(
                "rounded px-2 py-0.5 font-medium transition-colors",
                group.combine === opt
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt === "all" ? "All" : "Any"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => handlers.onRemove(path)}
          aria-label="Remove group"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
      {group.clauses.length > 0 ? (
        <NodeList nodes={group.clauses} combine={group.combine} path={path} {...handlers} />
      ) : (
        <p className="px-1 py-1.5 text-[0.8125rem] text-muted-foreground">
          Empty group — add a condition below.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handlers.onAdd(path, emptyClause())}
        className="w-full border-dashed text-muted-foreground hover:border-primary/40 hover:text-foreground"
      >
        <Plus className="size-3.5" aria-hidden />
        Add condition to group
      </Button>
    </div>
  );
}

// ─── Match-all / match-any ───────────────────────────────────────────────────

function CombineBar({
  combine,
  onChange,
}: {
  combine: "all" | "any";
  onChange: (combine: "all" | "any") => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
      <p className="text-[0.8125rem] text-muted-foreground">
        {combine === "all" ? "All conditions must match" : "Any condition can match"}
      </p>
      <div
        role="group"
        aria-label="How conditions combine"
        className="inline-flex shrink-0 rounded-lg border border-input bg-muted/30 p-0.5"
      >
        {(["all", "any"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={combine === opt}
            className={cn(
              "rounded-md px-2.5 py-1 text-[0.75rem] font-medium transition-colors",
              combine === opt
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt === "all" ? "All" : "Any"}
          </button>
        ))}
      </div>
    </div>
  );
}

function LogicConnector({ combine }: { combine: "all" | "any" }) {
  return (
    <div className="flex items-center gap-2 py-1.5 pl-4" aria-hidden>
      <span className="h-4 w-px bg-border" />
      <span
        className={cn(
          "rounded-full px-2.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em]",
          combine === "all"
            ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
            : "bg-violet-500/10 text-violet-600 dark:text-violet-400",
        )}
      >
        {combine === "all" ? "And" : "Or"}
      </span>
      <span className="h-px flex-1 bg-border/50" />
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyConditions({
  variant,
  canAdd = true,
  onAdd,
}: {
  variant: ConditionBuilderVariant;
  canAdd?: boolean;
  onAdd: () => void;
}) {
  if (variant === "trigger") {
    if (!canAdd) {
      return (
        <p className="text-[0.8125rem] text-muted-foreground">
          No filter fields for this trigger type.
        </p>
      );
    }
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        className="w-full border-dashed text-muted-foreground hover:border-primary/40 hover:text-foreground"
      >
        <Plus className="size-3.5" aria-hidden />
        Add filter (optional)
      </Button>
    );
  }

  const hint =
    variant === "branch"
      ? "When this is true, the Then path runs. Otherwise the Else path runs."
      : variant === "filter"
        ? "No filter — workflow always continues here."
        : "Add a condition to make this step selective.";

  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-3 py-4 text-center">
      <p className="text-[0.8125rem] text-muted-foreground">{hint}</p>
      <Button type="button" variant="outline" size="sm" onClick={onAdd} className="mt-3">
        <Plus className="size-3.5" aria-hidden />
        Add condition
      </Button>
    </div>
  );
}

// ─── Clause card ─────────────────────────────────────────────────────────────

function ClauseCard({
  index,
  clause,
  refs,
  embedded,
  onChange,
  onRemove,
}: {
  index: number;
  clause: Clause;
  refs: RefCandidate[];
  embedded?: boolean;
  onChange: (patch: Partial<Clause>) => void;
  onRemove: () => void;
}) {
  const grouped = useMemo(() => groupRefs(refs), [refs]);
  const ops = opsForType(clause.type);
  const needsValue = clause.op !== "empty" && clause.op !== "not_empty";

  const field = refs.find((r) => r.path === clause.path);
  const options = field?.options;
  const chipsValue = needsValue && clause.op === "is_any_of" && !!options?.length;

  function pickField(path: string) {
    const ref = refs.find((r) => r.path === path);
    const type: RefType = ref?.type ?? "string";
    const valid = opsForType(type).some((o) => o.id === clause.op);
    const op = valid ? clause.op : (opsForType(type)[0]?.id ?? "==");
    const patch: Partial<Clause> = { path, type, op };
    if (op !== "is_any_of" && ref?.options?.length && !ref.options.includes(clause.value)) {
      patch.value = ref.options[0];
    }
    onChange(patch);
  }

  const pathInRefs = refs.some((r) => r.path === clause.path);

  const valueWarning = !clause.path
    ? "Pick a field to check — this condition is ignored until you do."
    : clause.op === "is_any_of" && !clause.values.some((v) => v.trim() !== "")
      ? "Pick at least one value."
      : needsValue && !chipsValue && (clause.value ?? "").trim() === ""
        ? "Enter a value to compare against."
        : null;

  return (
    <div
      className={cn(
        "group relative",
        embedded
          ? "rounded-lg border border-border/50 bg-muted/20 py-2.5 pr-2 pl-3"
          : "rounded-xl border border-border/70 bg-card/50 shadow-sm",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2",
          embedded ? "mb-2" : "border-b border-border/40 px-3 py-2",
        )}
      >
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {embedded ? `Also when` : `Condition ${index + 1}`}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove condition"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className={cn("space-y-3", embedded ? "" : "p-3")}>
        <FieldBlock label="Field">
          <WorkflowSelect
            ariaLabel="Field"
            value={clause.path}
            onChange={(e) => pickField(e.target.value)}
            className="w-full"
          >
            <option value="" disabled>
              Pick a field to check…
            </option>
            {!pathInRefs && clause.path && (
              <option value={clause.path}>{clause.path}</option>
            )}
            {grouped.map(({ group, items }) => (
              <optgroup key={group} label={group}>
                {items.map((r) => (
                  <option key={r.path} value={r.path}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </WorkflowSelect>
        </FieldBlock>

        <div className={cn("grid gap-3", needsValue && !chipsValue ? "grid-cols-2" : "grid-cols-1")}>
          <FieldBlock label="How to match">
            <WorkflowSelect
              ariaLabel="Operator"
              value={clause.op}
              onChange={(e) => onChange({ op: e.target.value as ClauseOp })}
              className="w-full"
            >
              {ops.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </WorkflowSelect>
          </FieldBlock>

          {needsValue && !chipsValue && (
            <FieldBlock label="Value">
              <ValueInput
                clause={clause}
                options={options}
                sample={field?.sample}
                onChange={onChange}
                className="w-full"
              />
            </FieldBlock>
          )}
        </div>

        {needsValue && chipsValue && (
          <FieldBlock label="Values">
            <ValueInput
              clause={clause}
              options={options}
              sample={field?.sample}
              onChange={onChange}
            />
          </FieldBlock>
        )}

        {valueWarning && (
          <p className="text-[0.8125rem] text-amber-600 dark:text-amber-400">{valueWarning}</p>
        )}
        {!needsValue && clause.path && (
          <p className="text-[0.75rem] text-muted-foreground">
            No value needed — this just checks whether the field is filled in.
          </p>
        )}
      </div>
    </div>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </span>
      {children}
    </label>
  );
}

function ValueInput({
  clause,
  options,
  sample,
  onChange,
  className,
}: {
  clause: Clause;
  options?: string[];
  sample?: string;
  onChange: (patch: Partial<Clause>) => void;
  className?: string;
}) {
  const base =
    "h-9 w-full rounded-lg border bg-background px-3 text-[0.8125rem] text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring";

  if (clause.op === "is_any_of" && options?.length) {
    const selected = new Set(clause.values.filter((v) => v.trim() !== ""));
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const on = selected.has(opt);
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const next = new Set(selected);
                if (on) next.delete(opt);
                else next.add(opt);
                onChange({ values: options.filter((o) => next.has(o)) });
              }}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
                on
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-input bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {humanizeOption(opt)}
            </button>
          );
        })}
      </div>
    );
  }

  if (clause.op === "is_any_of") {
    const hasValues = clause.values.some((v) => v.trim() !== "");
    return (
      <input
        value={clause.values.join(", ")}
        onChange={(e) =>
          onChange({ values: e.target.value.split(",").map((s) => s.trim()) })
        }
        placeholder="e.g. high, urgent"
        aria-label="Values"
        aria-invalid={!hasValues}
        className={cn(base, hasValues ? "border-input" : "border-amber-500/60", className)}
      />
    );
  }

  if (options?.length) {
    const known = options.includes(clause.value);
    return (
      <WorkflowSelect
        ariaLabel="Value"
        value={clause.value || options[0]}
        onChange={(e) => onChange({ value: e.target.value })}
        className={className}
      >
        {!known && clause.value && <option value={clause.value}>{clause.value}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {humanizeOption(o)}
          </option>
        ))}
      </WorkflowSelect>
    );
  }

  if (clause.type === "boolean") {
    return (
      <WorkflowSelect
        ariaLabel="Value"
        value={clause.value || "true"}
        onChange={(e) => onChange({ value: e.target.value })}
        className={className}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </WorkflowSelect>
    );
  }

  if (clause.type === "date") {
    // Show a date picker but tolerate full ISO datetimes (e.g. trigger.fired_at
    // samples) by binding only the YYYY-MM-DD prefix to the input.
    return (
      <input
        type="date"
        value={(clause.value || "").slice(0, 10)}
        onChange={(e) => onChange({ value: e.target.value })}
        aria-label="Value"
        className={cn(base, "border-input", className)}
      />
    );
  }

  return (
    <input
      type={clause.type === "number" ? "number" : "text"}
      value={clause.value}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={
        sample ? `e.g. ${sample}` : clause.type === "number" ? "e.g. 5" : "Enter a value"
      }
      aria-label="Value"
      className={cn(base, "border-input", className)}
    />
  );
}

