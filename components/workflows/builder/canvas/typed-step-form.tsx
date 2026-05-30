"use client";

import { useCallback, useMemo } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FieldDef } from "@/lib/workflows/field-defs";
import type { RefCandidate } from "@/lib/workflows/refs";
import { TemplateField } from "@/components/workflows/builder/config/template-field";

// Renders an ordered list of FieldDef forms against a config object and
// emits a partial-merged config back. Each field reads/writes a single key
// at the top level of the config; nested values stay untouched so we never
// trample data the form doesn't know about.

type Config = Record<string, unknown>;

export function TypedStepForm({
  fields,
  value,
  onChange,
  refs = [],
}: {
  fields: FieldDef[];
  value: Config;
  onChange: (next: Config) => void;
  /** Insertable data refs for this step (trigger + upstream outputs + vars). */
  refs?: RefCandidate[];
}) {
  const set = useCallback(
    (key: string, v: unknown) => {
      const next = { ...value, [key]: v };
      // Drop empty optional strings + empty arrays so config stays clean.
      if (v === "" || v === undefined) delete next[key];
      onChange(next);
    },
    [value, onChange],
  );

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <FieldRenderer
          key={f.key}
          field={f}
          value={value[f.key]}
          refs={refs}
          onChange={(v) => set(f.key, v)}
        />
      ))}
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
  refs,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  refs: RefCandidate[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-[12px]">
        {field.label}
        {"required" in field && field.required && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>
      <FieldInput field={field} value={value} onChange={onChange} refs={refs} />
      {"help" in field && field.help && (
        <p className="text-[11px] leading-snug text-muted-foreground">{field.help}</p>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  refs,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  refs: RefCandidate[];
}) {
  switch (field.kind) {
    case "text":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="h-9 text-[13px]"
        />
      );

    case "template":
      return (
        <TemplateField
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
          placeholder={field.placeholder}
          mono
          refs={refs}
        />
      );

    case "textarea":
      return (
        <TemplateField
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
          placeholder={field.placeholder}
          multiline
          rows={field.rows ?? 3}
          refs={refs}
        />
      );

    case "enum":
      return (
        <div className="grid gap-1.5">
          {field.options.map((opt) => {
            const selected =
              (value as string | undefined) === opt.value ||
              (value === undefined && field.default === opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-[12.5px] transition-colors",
                  selected
                    ? "border-primary bg-primary/[0.06]"
                    : "border-border bg-background hover:border-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "size-3 shrink-0 rounded-full border-2",
                    selected
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/40",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span className="block text-[11px] text-muted-foreground">
                      {opt.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      );

    case "number": {
      const n =
        typeof value === "number" ? value : value === undefined ? field.default ?? 0 : 0;
      return (
        <Input
          type="number"
          value={n}
          min={field.min}
          max={field.max}
          onChange={(e) => {
            const next = e.target.value === "" ? undefined : Number(e.target.value);
            if (next === undefined || Number.isFinite(next)) onChange(next);
          }}
          className="h-9 w-32 text-[13px]"
        />
      );
    }

    case "duration":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? "30m"}
          className="h-9 w-32 font-mono text-[12.5px]"
        />
      );

    case "string-list":
      return <StringListField field={field} value={value} onChange={onChange} />;
  }
}

function StringListField({
  field,
  value,
  onChange,
}: {
  field: Extract<FieldDef, { kind: "string-list" }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const items = useMemo<string[]>(
    () => (Array.isArray(value) ? (value as string[]) : []),
    [value],
  );

  function setAt(i: number, v: string) {
    const next = [...items];
    next[i] = v;
    onChange(next);
  }

  function removeAt(i: number) {
    const next = items.filter((_, idx) => idx !== i);
    onChange(next.length === 0 ? undefined : next);
  }

  function add() {
    onChange([...items, ""]);
  }

  return (
    <div className="space-y-1.5">
      {items.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-[11.5px] text-muted-foreground">
          No items yet.
        </p>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={item}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder={field.itemPlaceholder}
            className="h-8 text-[12.5px]"
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            aria-label="Remove"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Minus className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Plus className="size-3" /> Add item
      </button>
    </div>
  );
}
