"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, CornerDownRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupRefs, type RefCandidate, type RefType } from "@/lib/workflows/refs";
import {
  emptyClause,
  opsForType,
  parseCondition,
  serializeCondition,
  type Clause,
  type ClauseOp,
  type ConditionModel,
} from "@/lib/workflows/jsonlogic-codec";
import { explainCondition } from "@/lib/workflows/explain-expr";
import { JsonEditor } from "./json-editor";

// Plain-English condition builder. Edits a flat ALL/ANY list of Field·Op·Value
// rows and emits JSONLogic via the codec. Falls back to raw JSON for anything
// the flat model can't represent (nested groups, exotic operators) so power is
// never lost. Field choices come from `refs` (trigger + upstream outputs) so
// nobody types a dotted path.
//
// Layout — each condition reads as a sentence on a single line
// (Field → Operator → Value), and the AND/OR that joins them is shown as an
// explicit connector between rows, mirroring how builders like Zapier Paths,
// Slack, and n8n present branch logic.

// JSONLogic carries no field types, so a round-tripped number-vs-string is only
// recoverable from the field catalog. Re-stamp each clause's `type` from the
// chosen field's ref so the right value widget (and coercion) survives a reload
// even when the stored value looked like a string.
function enrichTypes(model: ConditionModel, refs: RefCandidate[]): ConditionModel {
  return {
    ...model,
    clauses: model.clauses.map((c) => {
      const ref = refs.find((r) => r.path === c.path);
      return ref ? { ...c, type: ref.type } : c;
    }),
  };
}

export function ConditionBuilder({
  value,
  onChange,
  refs,
}: {
  value: unknown;
  onChange: (expr: unknown | undefined) => void;
  refs: RefCandidate[];
}) {
  // Latest refs in a ref so the re-seed effect can recover field types without
  // taking `refs` as a dependency — refs change identity on every spec edit,
  // and re-seeding then would clobber in-progress rows. Synced in an effect (not
  // during render); it runs before the value effect below, so a same-render
  // refs+value change still re-seeds against fresh refs.
  const refsRef = useRef(refs);
  useEffect(() => {
    refsRef.current = refs;
  });

  const [model, setModel] = useState<ConditionModel>(() => {
    const parsed = parseCondition(value);
    return parsed ? enrichTypes(parsed, refs) : { combine: "all", clauses: [] };
  });
  const [mode, setMode] = useState<"simple" | "json">(
    value !== undefined && parseCondition(value) === null ? "json" : "simple",
  );

  // Keep the last expr we emitted so external value changes (switching steps)
  // re-seed the model, while our own emits don't clobber in-progress blank rows.
  const lastEmitted = useRef<string>(JSON.stringify(value ?? null));

  useEffect(() => {
    const incoming = JSON.stringify(value ?? null);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    const parsed = parseCondition(value);
    if (parsed) {
      setModel(enrichTypes(parsed, refsRef.current));
      setMode("simple");
    } else if (value !== undefined) {
      setMode("json");
    }
  }, [value]);

  function update(next: ConditionModel) {
    setModel(next);
    const expr = serializeCondition(next);
    lastEmitted.current = JSON.stringify(expr ?? null);
    onChange(expr);
  }

  function setClause(i: number, patch: Partial<Clause>) {
    const clauses = model.clauses.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    update({ ...model, clauses });
  }

  function addClause() {
    update({ ...model, clauses: [...model.clauses, emptyClause()] });
  }

  function removeClause(i: number) {
    update({ ...model, clauses: model.clauses.filter((_, idx) => idx !== i) });
  }

  const readsAs = useMemo(() => {
    const expr = serializeCondition(model);
    return expr === undefined ? null : explainCondition(expr);
  }, [model]);

  const hasClauses = model.clauses.length > 0;
  const multi = model.clauses.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <ModeToggle mode={mode} setMode={setMode} />
        {mode === "simple" && hasClauses && (
          <button
            type="button"
            onClick={() => update({ combine: "all", clauses: [] })}
            className="rounded-lg px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Remove all conditions"
          >
            Clear all
          </button>
        )}
      </div>

      {mode === "simple" ? (
        <div className="space-y-3">
          {/* Match-all / match-any — the AND/OR for the whole group. Disabled
              until there are two clauses to actually combine. */}
          <CombineToggle
            combine={model.combine}
            disabled={!multi}
            onChange={(combine) => update({ ...model, combine })}
          />

          {hasClauses ? (
            <ul role="list" className="space-y-0">
              {model.clauses.map((c, i) => (
                <li key={i}>
                  {i > 0 && <Connector combine={model.combine} />}
                  <ClauseRow
                    index={i}
                    clause={c}
                    refs={refs}
                    onChange={(patch) => setClause(i, patch)}
                    onRemove={() => removeClause(i)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-5 text-center">
              <p className="text-[0.875rem] font-medium text-foreground">
                No conditions yet
              </p>
              <p className="mx-auto mt-1 max-w-[42ch] text-[0.8125rem] text-muted-foreground">
                The step runs every time it&apos;s reached. Add a condition to make
                it selective.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={addClause}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-[0.8125rem] font-medium text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="size-4" aria-hidden /> Add condition
          </button>

          {readsAs && (
            <div className="rounded-xl border border-primary/15 bg-primary/[0.04] px-3.5 py-3">
              <div className="flex items-center gap-1.5">
                <CornerDownRight className="size-3.5 text-primary/70" aria-hidden />
                <p className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Reads as
                </p>
              </div>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-pretty text-foreground/90">
                {readsAs}
              </p>
            </div>
          )}
        </div>
      ) : (
        <JsonEditor
          value={value ?? {}}
          onChange={(next) => {
            const expr =
              next && typeof next === "object" && Object.keys(next).length === 0
                ? undefined
                : next;
            lastEmitted.current = JSON.stringify(expr ?? null);
            onChange(expr);
          }}
          hint="Raw JSONLogic. Supported ops: ==, !=, >, >=, <, <=, in, and, or, not, var"
        />
      )}
    </div>
  );
}

// ─── Match-all / match-any toggle ───────────────────────────────────────────

function CombineToggle({
  combine,
  disabled,
  onChange,
}: {
  combine: "all" | "any";
  disabled: boolean;
  onChange: (combine: "all" | "any") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div
        role="group"
        aria-label="How conditions combine"
        className={cn(
          "inline-flex rounded-lg border border-input bg-background p-0.5",
          disabled && "opacity-60",
        )}
      >
        {(["all", "any"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt)}
            aria-pressed={combine === opt}
            className={cn(
              "rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
              combine === opt
                ? "bg-secondary text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              disabled && "cursor-default hover:text-muted-foreground",
            )}
          >
            Match {opt}
          </button>
        ))}
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">
        {disabled
          ? "Add conditions below."
          : combine === "all"
            ? "Every condition must be true."
            : "Any one condition can be true."}
      </p>
    </div>
  );
}

// ─── AND / OR connector between rows ────────────────────────────────────────

function Connector({ combine }: { combine: "all" | "any" }) {
  return (
    <div className="flex items-center gap-2 pl-3" aria-hidden>
      <span className="h-3 w-px bg-border" />
      <span className="rounded-md bg-secondary px-2 py-0.5 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {combine === "all" ? "And" : "Or"}
      </span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  );
}

// ─── Clause row ─────────────────────────────────────────────────────────────

function ClauseRow({
  index,
  clause,
  refs,
  onChange,
  onRemove,
}: {
  index: number;
  clause: Clause;
  refs: RefCandidate[];
  onChange: (patch: Partial<Clause>) => void;
  onRemove: () => void;
}) {
  const grouped = useMemo(() => groupRefs(refs), [refs]);
  const ops = opsForType(clause.type);
  const needsValue = clause.op !== "empty" && clause.op !== "not_empty";
  const fieldId = `cond-field-${index}`;
  const opId = `cond-op-${index}`;

  function pickField(path: string) {
    const ref = refs.find((r) => r.path === path);
    const type: RefType = ref?.type ?? "string";
    // Keep the operator if still valid for the new type; else first valid op.
    const valid = opsForType(type).some((o) => o.id === clause.op);
    onChange({
      path,
      type,
      op: valid ? clause.op : (opsForType(type)[0]?.id ?? "=="),
    });
  }

  // Surface a legacy/custom path that isn't in the catalog refs.
  const pathInRefs = refs.some((r) => r.path === clause.path);

  const valueWarning =
    clause.op === "is_any_of" && !clause.values.some((v) => v.trim() !== "")
      ? "Add at least one value, or this condition won't be saved."
      : null;

  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-2.5">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <SelectShell
            id={fieldId}
            ariaLabel="Field"
            value={clause.path}
            onChange={(e) => pickField(e.target.value)}
            className="min-w-[10rem] flex-1"
          >
            <option value="" disabled>
              Choose data…
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
          </SelectShell>

          <SelectShell
            id={opId}
            ariaLabel="Operator"
            value={clause.op}
            onChange={(e) => onChange({ op: e.target.value as ClauseOp })}
            className="min-w-[8rem]"
          >
            {ops.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </SelectShell>

          {needsValue && (
            <ValueInput
              clause={clause}
              onChange={onChange}
              className="min-w-[9rem] flex-1"
            />
          )}
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove condition"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {valueWarning && (
        <p className="mt-1.5 pl-0.5 text-[0.8125rem] text-amber-600 dark:text-amber-400">
          {valueWarning}
        </p>
      )}
    </div>
  );
}

function ValueInput({
  clause,
  onChange,
  className,
}: {
  clause: Clause;
  onChange: (patch: Partial<Clause>) => void;
  className?: string;
}) {
  const base =
    "h-9 w-full rounded-lg border bg-background px-3 text-[0.8125rem] text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring";

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

  if (clause.type === "boolean") {
    return (
      <SelectShell
        ariaLabel="Value"
        value={clause.value || "true"}
        onChange={(e) => onChange({ value: e.target.value })}
        className={className}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </SelectShell>
    );
  }

  return (
    <input
      type={clause.type === "number" ? "number" : "text"}
      value={clause.value}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={clause.type === "number" ? "e.g. 5" : 'e.g. "urgent"'}
      aria-label="Value"
      className={cn(base, "border-input", className)}
    />
  );
}

// ─── Custom-chevron select shell ────────────────────────────────────────────
// Native <select> styled to match the rest of the builder, with a consistent
// cross-browser chevron (per the form-control guidelines).

function SelectShell({
  id,
  ariaLabel,
  value,
  onChange,
  disabled,
  className,
  children,
}: {
  id?: string;
  ariaLabel: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-grid h-9 grid-cols-[1fr_--spacing(7)] items-center rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring",
        disabled && "opacity-60",
        className,
      )}
    >
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="col-span-full row-start-1 appearance-none truncate bg-transparent py-2 pr-7 pl-3 text-[0.8125rem] text-foreground focus:outline-none"
      >
        {children}
      </select>
      <svg
        viewBox="0 0 8 5"
        width="9"
        height="6"
        fill="none"
        aria-hidden
        className="pointer-events-none col-start-2 row-start-1 place-self-center text-muted-foreground"
      >
        <path d="M.5.5 4 4 7.5.5" stroke="currentColor" strokeWidth="1" />
      </svg>
    </div>
  );
}

function ModeToggle({
  mode,
  setMode,
}: {
  mode: "simple" | "json";
  setMode: (m: "simple" | "json") => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-input bg-background p-0.5">
      <button
        type="button"
        onClick={() => setMode("simple")}
        aria-pressed={mode === "simple"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium",
          mode === "simple"
            ? "bg-secondary text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Sparkles className="size-3.5" /> Builder
      </button>
      <button
        type="button"
        onClick={() => setMode("json")}
        aria-pressed={mode === "json"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium",
          mode === "json"
            ? "bg-secondary text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Braces className="size-3.5" /> JSON
      </button>
    </div>
  );
}
