"use client";

import { useCallback, useMemo } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FieldDef } from "@/lib/workflows/field-defs";
import type { RefCandidate } from "@/lib/workflows/refs";
import type { PropertyChannel } from "@/lib/chat/channels";
import { ChannelField } from "@/components/workflows/builder/config/channel-field";
import { TemplateField } from "@/components/workflows/builder/config/template-field";
import { WorkflowSelect } from "@/components/workflows/builder/workflow-select";

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
  channels = [],
  channelsLoading,
  triggerEventType,
  formKey,
}: {
  fields: FieldDef[];
  value: Config;
  onChange: (next: Config) => void;
  /** Insertable data refs for this step (trigger + upstream outputs + vars). */
  refs?: RefCandidate[];
  channels?: PropertyChannel[];
  channelsLoading?: boolean;
  triggerEventType?: string;
  /** Resets channel prefill when the edited step changes. */
  formKey?: string;
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
          channels={channels}
          channelsLoading={channelsLoading}
          triggerEventType={triggerEventType}
          formKey={formKey}
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
  channels,
  channelsLoading,
  triggerEventType,
  formKey,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  refs: RefCandidate[];
  channels: PropertyChannel[];
  channelsLoading?: boolean;
  triggerEventType?: string;
  formKey?: string;
}) {
  const required = "required" in field && Boolean(field.required);
  const invalid = required && isBlankValue(value);
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1 text-[0.8125rem] font-medium text-foreground">
        {field.label}
        {required && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>
      <FieldInput
        field={field}
        value={value}
        onChange={onChange}
        refs={refs}
        channels={channels}
        channelsLoading={channelsLoading}
        triggerEventType={triggerEventType}
        formKey={formKey}
        invalid={invalid}
      />
      {invalid ? (
        <p className="text-[0.8125rem] font-medium text-destructive">{field.label} is required</p>
      ) : "help" in field && field.help ? (
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">{field.help}</p>
      ) : null}
    </div>
  );
}

// Matches builder-shell's computeInvalid so the inline note and the card badge
// agree on what "empty" means: missing, empty string, or empty array.
function isBlankValue(v: unknown): boolean {
  return v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function FieldInput({
  field,
  value,
  onChange,
  refs,
  channels,
  channelsLoading,
  triggerEventType,
  formKey,
  invalid,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  refs: RefCandidate[];
  channels: PropertyChannel[];
  channelsLoading?: boolean;
  triggerEventType?: string;
  formKey?: string;
  invalid?: boolean;
}) {
  const invalidInput = invalid && "border-destructive focus-visible:ring-destructive/30";
  switch (field.kind) {
    case "channel":
      return (
        <ChannelField
          key={formKey}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
          channels={channels}
          channelsLoading={channelsLoading}
          triggerEventType={triggerEventType}
          refs={refs}
        />
      );

    case "text":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          aria-invalid={invalid || undefined}
          className={cn("h-9 text-[0.8125rem]", invalidInput)}
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
          invalid={invalid}
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
          invalid={invalid}
        />
      );

    case "enum":
      return <EnumField field={field} value={value} onChange={onChange} />;

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
          className="h-9 w-32 text-[0.8125rem]"
        />
      );
    }

    case "duration":
      return <DurationField value={value} onChange={onChange} />;

    case "string-list":
      return <StringListField field={field} value={value} onChange={onChange} />;

    case "key-value":
      return <KeyValueField field={field} value={value} onChange={onChange} />;
  }
}

// Single-choice picker. Option sets that carry descriptions (e.g. summary
// length) read best as a tight radio-card list; plain sets (tone, role, status)
// become a compact wrap of selectable chips — fewer pixels, easier to scan.
function EnumField({
  field,
  value,
  onChange,
}: {
  field: Extract<FieldDef, { kind: "enum" }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const isSelected = (v: string) =>
    (value as string | undefined) === v || (value === undefined && field.default === v);
  const hasDescriptions = field.options.some((o) => o.description);

  if (!hasDescriptions) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((opt) => {
          const selected = isSelected(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={selected}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-input bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      {field.options.map((opt) => {
        const selected = isSelected(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
              selected
                ? "border-primary bg-primary/[0.06]"
                : "border-input bg-background hover:border-foreground/30",
            )}
          >
            <span
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border",
                selected ? "border-primary" : "border-muted-foreground/40",
              )}
              aria-hidden
            >
              {selected && <span className="size-2 rounded-full bg-primary" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <span className="text-[0.8125rem] font-medium text-foreground">{opt.label}</span>
              {opt.description && (
                <span className="text-[0.78rem] text-muted-foreground">{opt.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Structured duration: a number + a unit, emitting the `\d+(s|m|h|d)` shape the
// schema expects (e.g. "30m"). Parses an existing string back into the two
// controls.
const DURATION_UNITS = [
  { value: "s", label: "seconds" },
  { value: "m", label: "minutes" },
  { value: "h", label: "hours" },
  { value: "d", label: "days" },
] as const;

function DurationField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const match = typeof value === "string" ? value.match(/^(\d+)\s*(s|m|h|d)$/) : null;
  const amount = match ? match[1]! : "";
  const unit = match ? match[2]! : "m";

  function emit(nextAmount: string, nextUnit: string) {
    const n = nextAmount.trim();
    onChange(n === "" ? undefined : `${n}${nextUnit}`);
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => emit(e.target.value, unit)}
        placeholder="30"
        className="h-9 w-24 text-[0.8125rem]"
      />
      <WorkflowSelect
        ariaLabel="Duration unit"
        value={unit}
        onChange={(e) => emit(amount || "1", e.target.value)}
        className="w-auto min-w-[5.5rem]"
      >
        {DURATION_UNITS.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </WorkflowSelect>
    </div>
  );
}

// Editable key/value pairs → a Record<string,string>. Replaces forced raw JSON
// for fields like entity.create `data` / entity.update `patch`.
function KeyValueField({
  field,
  value,
  onChange,
}: {
  field: Extract<FieldDef, { kind: "key-value" }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const entries = useMemo<Array<[string, string]>>(
    () =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
        : [],
    [value],
  );

  function emit(next: Array<[string, string]>) {
    const obj: Record<string, string> = {};
    for (const [k, v] of next) if (k.trim()) obj[k.trim()] = v;
    onChange(Object.keys(obj).length === 0 ? undefined : obj);
  }

  return (
    <div className="space-y-1.5">
      {entries.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-2.5 text-[0.8125rem] text-muted-foreground">
          No fields yet.
        </p>
      )}
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={k}
            onChange={(e) => {
              const next = entries.map((p, idx) => (idx === i ? [e.target.value, p[1]] : p)) as Array<[string, string]>;
              emit(next);
            }}
            placeholder={field.keyPlaceholder ?? "field"}
            className="h-9 flex-1 text-[0.8125rem]"
          />
          <Input
            value={v}
            onChange={(e) => {
              const next = entries.map((p, idx) => (idx === i ? [p[0], e.target.value] : p)) as Array<[string, string]>;
              emit(next);
            }}
            placeholder={field.valuePlaceholder ?? "value"}
            className="h-9 flex-1 text-[0.8125rem]"
          />
          <button
            type="button"
            onClick={() => emit(entries.filter((_, idx) => idx !== i))}
            aria-label="Remove field"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Minus className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => emit([...entries, ["", ""]])}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Plus className="size-3.5" /> Add field
      </button>
    </div>
  );
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
        <p className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-2.5 text-[0.8125rem] text-muted-foreground">
          No items yet.
        </p>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={item}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder={field.itemPlaceholder}
            className="h-9 text-[0.8125rem]"
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            aria-label="Remove"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Minus className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Plus className="size-3.5" /> Add item
      </button>
    </div>
  );
}
