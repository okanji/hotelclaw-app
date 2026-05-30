"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, Plus, Sparkles, Trash2 } from "lucide-react";
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

export function ConditionBuilder({
  value,
  onChange,
  refs,
}: {
  value: unknown;
  onChange: (expr: unknown | undefined) => void;
  refs: RefCandidate[];
}) {
  const [model, setModel] = useState<ConditionModel>(
    () => parseCondition(value) ?? { combine: "all", clauses: [] },
  );
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
      setModel(parsed);
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

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <ModeToggle mode={mode} setMode={setMode} />
        {mode === "simple" && model.clauses.length > 0 && (
          <button
            type="button"
            onClick={() => update({ combine: "all", clauses: [] })}
            className="rounded-md border border-input px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary"
            title="Clear all conditions"
          >
            Clear
          </button>
        )}
      </div>

      {mode === "simple" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
            <span>Run this when</span>
            <select
              value={model.combine}
              onChange={(e) =>
                update({ ...model, combine: e.target.value as "all" | "any" })
              }
              disabled={model.clauses.length < 2}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-[12px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            >
              <option value="all">ALL</option>
              <option value="any">ANY</option>
            </select>
            <span>of these are true:</span>
          </div>

          {model.clauses.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-2.5 text-[12px] text-muted-foreground">
              No conditions — this always runs. Add one below.
            </p>
          ) : (
            <div className="space-y-1.5">
              {model.clauses.map((c, i) => (
                <ClauseRow
                  key={i}
                  clause={c}
                  refs={refs}
                  onChange={(patch) => setClause(i, patch)}
                  onRemove={() => removeClause(i)}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={addClause}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="size-3" /> Add condition
          </button>

          {readsAs && (
            <p className="rounded-md bg-muted/[0.04] px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
              <span className="font-medium text-foreground/60">Reads as </span>
              {readsAs}
            </p>
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

// ─── Clause row ───────────────────────────────────────────────────────────────

function ClauseRow({
  clause,
  refs,
  onChange,
  onRemove,
}: {
  clause: Clause;
  refs: RefCandidate[];
  onChange: (patch: Partial<Clause>) => void;
  onRemove: () => void;
}) {
  const grouped = useMemo(() => groupRefs(refs), [refs]);
  const ops = opsForType(clause.type);
  const needsValue = clause.op !== "empty" && clause.op !== "not_empty";

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

  return (
    <div className="rounded-md border border-border/60 bg-muted/[0.03] p-1.5">
      <div className="flex items-center gap-1.5">
        <select
          value={clause.path}
          onChange={(e) => pickField(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
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
        </select>

        <select
          value={clause.op}
          onChange={(e) => onChange({ op: e.target.value as ClauseOp })}
          className="h-8 shrink-0 rounded-md border border-input bg-background px-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {ops.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove condition"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {needsValue && (
        <div className="mt-1.5">
          <ValueInput clause={clause} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function ValueInput({
  clause,
  onChange,
}: {
  clause: Clause;
  onChange: (patch: Partial<Clause>) => void;
}) {
  if (clause.op === "is_any_of") {
    return (
      <input
        value={clause.values.join(", ")}
        onChange={(e) =>
          onChange({ values: e.target.value.split(",").map((s) => s.trim()) })
        }
        placeholder="e.g. high, urgent"
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    );
  }

  if (clause.type === "boolean") {
    return (
      <select
        value={clause.value || "true"}
        onChange={(e) => onChange({ value: e.target.value })}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  return (
    <input
      type={clause.type === "number" ? "number" : "text"}
      value={clause.value}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={clause.type === "number" ? "e.g. 5" : 'e.g. "urgent"'}
      className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
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
    <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
      <button
        type="button"
        onClick={() => setMode("simple")}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-0.5",
          mode === "simple" ? "bg-muted text-foreground" : "text-muted-foreground",
        )}
      >
        <Sparkles className="size-3" /> Simple
      </button>
      <button
        type="button"
        onClick={() => setMode("json")}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-0.5",
          mode === "json" ? "bg-muted text-foreground" : "text-muted-foreground",
        )}
      >
        <Braces className="size-3" /> JSON
      </button>
    </div>
  );
}
