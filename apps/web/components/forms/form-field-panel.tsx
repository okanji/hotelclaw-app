"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { arrayMove } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CONDITION_OPS,
  PRIORITY_FIELD_OPTIONS,
  TASK_PROPERTY_META,
  newFieldId,
  type ConditionOp,
  type FormField,
  type FormFieldCondition,
  type FormSchema,
  type TaskPropertyKind,
} from "@/lib/forms/schema";
import { SourcePicker } from "./form-builder-extras";
import { FIELD_KIND } from "./field-kinds";

/**
 * One field's details in the builder's side card — the studio builder's
 * FieldPanel layout (the field's own title as the heading, its type
 * underneath, a close button back to "Add a field"), carrying every
 * capability of our previous inline editor: data-connected options, task
 * property mapping, number bounds, rating scale, and conditional logic.
 */

/** Which task property a field type can map onto. */
const MAPPABLE: Partial<Record<FormField["type"], TaskPropertyKind>> = {
  people: "assignee",
  select: "priority",
  date: "due_date",
  multi_select: "labels",
};

const PLACEHOLDER_TYPES: FormField["type"][] = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
];

export function FieldPanel({
  field,
  index,
  schema,
  propertyId,
  onPatch,
  onClose,
}: {
  field: FormField;
  index: number;
  schema: FormSchema;
  propertyId: string;
  onPatch: (patch: Partial<FormField>) => void;
  onClose: () => void;
}) {
  const kind = FIELD_KIND[field.type];
  const isChoice = field.type === "select" || field.type === "multi_select";
  const isLayout = field.type === "section" || field.type === "info";
  const mappable = MAPPABLE[field.type];
  const priorityMapped = field.taskProperty === "priority";
  const titleLabel =
    field.type === "section"
      ? "Heading"
      : field.type === "info"
        ? "Text"
        : field.type === "consent"
          ? "Title"
          : "Question";
  const secondaryLabel =
    field.type === "consent"
      ? "What the respondent agrees to"
      : field.type === "info"
        ? "Secondary text"
        : field.type === "section"
          ? "Description"
          : "Help text";

  function setTaskProperty(next: string) {
    if (!next) {
      onPatch({ taskProperty: undefined });
      return;
    }
    const k = next as TaskPropertyKind;
    if (k === "priority") {
      // Priority options are fixed — their ids ARE the task priority values.
      onPatch({
        taskProperty: k,
        source: undefined,
        options: PRIORITY_FIELD_OPTIONS.map((o) => ({ ...o })),
      });
      return;
    }
    onPatch({ taskProperty: k });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="text-base font-semibold break-words text-pretty">
            {field.label.trim() || `Untitled ${kind.label.toLowerCase()}`}
          </h2>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <kind.icon className="size-3.5" aria-hidden />
            {kind.label} · question {index + 1}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mt-1 -mr-1.5 shrink-0"
                onClick={onClose}
                aria-label="Close and go back to Add a field"
              />
            }
          >
            <X />
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`fp-label-${field.id}`}>{titleLabel}</Label>
        {field.type === "info" ? (
          <Textarea
            id={`fp-label-${field.id}`}
            value={field.label}
            rows={4}
            autoFocus
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        ) : (
          <Input
            id={`fp-label-${field.id}`}
            value={field.label}
            autoFocus
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`fp-desc-${field.id}`}>{secondaryLabel}</Label>
        {field.type === "consent" || field.type === "info" ? (
          <Textarea
            id={`fp-desc-${field.id}`}
            value={field.description ?? ""}
            rows={field.type === "consent" ? 5 : 3}
            onChange={(e) => onPatch({ description: e.target.value || undefined })}
          />
        ) : (
          <Input
            id={`fp-desc-${field.id}`}
            value={field.description ?? ""}
            placeholder="Optional, shown under the question"
            onChange={(e) => onPatch({ description: e.target.value || undefined })}
          />
        )}
      </div>

      {PLACEHOLDER_TYPES.includes(field.type) ? (
        <div className="grid gap-2">
          <Label htmlFor={`fp-ph-${field.id}`}>Placeholder</Label>
          <Input
            id={`fp-ph-${field.id}`}
            value={field.placeholder ?? ""}
            placeholder="Optional"
            onChange={(e) => onPatch({ placeholder: e.target.value || undefined })}
          />
        </div>
      ) : null}

      {isChoice && !priorityMapped ? (
        <>
          <SourcePicker propertyId={propertyId} field={field} onPatch={onPatch} />
          {!field.source ? (
            <OptionsEditor
              options={field.options ?? []}
              onChange={(options) => onPatch({ options })}
            />
          ) : null}
        </>
      ) : null}
      {priorityMapped ? (
        <p className="text-xs text-muted-foreground">
          Answers are the task priorities (Urgent / High / Medium / Low).
        </p>
      ) : null}

      {field.type === "number" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-2">
            <Label htmlFor={`fp-min-${field.id}`}>Lowest</Label>
            <Input
              id={`fp-min-${field.id}`}
              type="number"
              value={field.min ?? ""}
              onChange={(e) =>
                onPatch({ min: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`fp-max-${field.id}`}>Highest</Label>
            <Input
              id={`fp-max-${field.id}`}
              type="number"
              value={field.max ?? ""}
              onChange={(e) =>
                onPatch({ max: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </div>
        </div>
      ) : null}

      {field.type === "rating" ? (
        <div className="grid gap-2">
          <Label htmlFor={`fp-scale-${field.id}`}>Scale (3–10)</Label>
          <Input
            id={`fp-scale-${field.id}`}
            type="number"
            min={3}
            max={10}
            value={field.maxRating ?? 5}
            onChange={(e) => {
              const n = Number(e.target.value);
              onPatch({
                maxRating: Number.isInteger(n) ? Math.min(10, Math.max(3, n)) : undefined,
              });
            }}
            className="w-24"
          />
        </div>
      ) : null}

      {!isLayout ? (
        <div className="flex items-start justify-between gap-4 border-y border-border py-3">
          <label htmlFor={`fp-req-${field.id}`} className="grid gap-0.5">
            <span className="text-sm font-medium">Required</span>
            <span className="text-xs text-muted-foreground">
              {field.type === "consent"
                ? "The form can’t be sent until this is ticked."
                : "The form can’t be sent without an answer."}
            </span>
          </label>
          <Switch
            id={`fp-req-${field.id}`}
            checked={field.required ?? false}
            onCheckedChange={(checked) => onPatch({ required: checked || undefined })}
            className="mt-0.5"
          />
        </div>
      ) : null}

      {mappable ? (
        <div className="grid gap-2">
          <Label htmlFor={`fp-map-${field.id}`}>Copy the answer to the task</Label>
          <NativeSelect
            id={`fp-map-${field.id}`}
            value={field.taskProperty ?? ""}
            onChange={(e) => setTaskProperty(e.target.value)}
          >
            <option value="">No</option>
            <option value={mappable}>
              Yes, as its {TASK_PROPERTY_META[mappable].label.toLowerCase()}
            </option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {field.taskProperty
              ? `${TASK_PROPERTY_META[field.taskProperty].description} — when submissions create tasks (Form settings).`
              : "Feed this answer into the task created from each submission."}
          </p>
        </div>
      ) : null}

      {!isLayout || field.condition ? (
        <LogicEditor field={field} schema={schema} onPatch={onPatch} />
      ) : null}
    </div>
  );
}

/* --------------------------- Conditional logic --------------------------- */

const OP_LABELS: Record<ConditionOp, string> = {
  answered: "is answered",
  not_answered: "is not answered",
  equals: "is",
  not_equals: "is not",
  contains: "contains",
};

/** Ops that make sense for a given controller field type. */
function opsForController(controller: FormField): ConditionOp[] {
  switch (controller.type) {
    case "select":
    case "people":
      return controller.source && controller.type === "select"
        ? ["answered", "not_answered"]
        : controller.type === "people"
          ? ["answered", "not_answered"]
          : ["answered", "not_answered", "equals", "not_equals"];
    case "multi_select":
      return controller.source
        ? ["answered", "not_answered"]
        : ["answered", "not_answered", "contains"];
    case "yes_no":
    case "consent":
      return ["answered", "not_answered", "equals"];
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
      return ["answered", "not_answered", "equals", "not_equals", "contains"];
    case "number":
    case "rating":
    case "date":
      return ["answered", "not_answered", "equals", "not_equals"];
    default:
      return ["answered", "not_answered"];
  }
}

/**
 * "Show this question only when…" — the condition may only reference an
 * EARLIER question (visibility is a single ordered pass), so the controller
 * picker lists the fields above this one.
 */
function LogicEditor({
  field,
  schema,
  onPatch,
}: {
  field: FormField;
  schema: FormSchema;
  onPatch: (patch: Partial<FormField>) => void;
}) {
  const index = schema.fields.findIndex((f) => f.id === field.id);
  const candidates = schema.fields
    .slice(0, Math.max(0, index))
    .filter((f) => !["section", "info", "file", "signature"].includes(f.type));

  const condition = field.condition;
  const controller = condition
    ? candidates.find((f) => f.id === condition.fieldId)
    : undefined;

  function setCondition(next: FormFieldCondition | undefined) {
    onPatch({ condition: next });
  }

  if (candidates.length === 0) return null;

  const ops = controller ? opsForController(controller) : CONDITION_OPS.slice();
  const needsValue =
    condition && ["equals", "not_equals", "contains"].includes(condition.op);

  return (
    <div className="space-y-1.5">
      <Label>When to ask</Label>
      <div className="flex flex-col gap-1.5">
        <NativeSelect
          value={condition ? "when" : "always"}
          aria-label="Visibility"
          onChange={(e) => {
            if (e.target.value === "always") {
              setCondition(undefined);
            } else {
              const first = candidates[0];
              setCondition({ fieldId: first.id, op: "answered" });
            }
          }}
        >
          <option value="always">Always</option>
          <option value="when">Only when an earlier answer…</option>
        </NativeSelect>

        {condition ? (
          <div className="grid grid-cols-2 gap-1.5">
            <NativeSelect
              value={condition.fieldId}
              aria-label="Condition question"
              onChange={(e) => {
                const next = candidates.find((f) => f.id === e.target.value);
                if (!next) return;
                const nextOps = opsForController(next);
                setCondition({
                  fieldId: next.id,
                  op: nextOps.includes(condition.op) ? condition.op : nextOps[0],
                  value: undefined,
                });
              }}
            >
              {candidates.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={condition.op}
              aria-label="Condition operator"
              onChange={(e) =>
                setCondition({
                  ...condition,
                  op: e.target.value as ConditionOp,
                  value: undefined,
                })
              }
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </NativeSelect>
            {needsValue && controller ? (
              <div className="col-span-2">
                <ConditionValueInput
                  controller={controller}
                  value={condition.value ?? ""}
                  onChange={(value) => setCondition({ ...condition, value })}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConditionValueInput({
  controller,
  value,
  onChange,
}: {
  controller: FormField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (
    (controller.type === "select" || controller.type === "multi_select") &&
    !controller.source
  ) {
    return (
      <NativeSelect
        value={value}
        aria-label="Condition value"
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Pick an option…</option>
        {(controller.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    );
  }
  if (controller.type === "yes_no" || controller.type === "consent") {
    return (
      <NativeSelect
        value={value}
        aria-label="Condition value"
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Pick…</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </NativeSelect>
    );
  }
  return (
    <Input
      value={value}
      type={
        controller.type === "number" || controller.type === "rating"
          ? "number"
          : controller.type === "date"
            ? "date"
            : "text"
      }
      aria-label="Condition value"
      placeholder="Value…"
      onChange={(e) => onChange(e.target.value)}
      className="h-8"
    />
  );
}

/* ----------------------------- Options editor ---------------------------- */

function OptionsEditor({
  options,
  onChange,
}: {
  options: { id: string; label: string }[];
  onChange: (options: { id: string; label: string }[]) => void;
}) {
  // Focus the row created by Enter / bulk paste once it exists in the DOM.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    document
      .querySelector<HTMLInputElement>(`[data-option-input="${pendingFocus.current}"]`)
      ?.focus();
    pendingFocus.current = null;
  });

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    onChange(arrayMove(options, index, target));
  }

  function insertAfter(index: number, labels: string[]) {
    const created = labels.map((label) => ({ id: newFieldId(), label }));
    if (created.length === 0) return;
    const next = [...options];
    next.splice(index + 1, 0, ...created);
    pendingFocus.current = created[created.length - 1].id;
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      <Label>Answers</Label>
      <div className="flex flex-col gap-1.5">
        {options.map((option, i) => (
          <div key={option.id} className="flex items-center gap-1">
            <Input
              value={option.label}
              data-option-input={option.id}
              aria-label={`Option ${i + 1}`}
              placeholder={`Option ${i + 1}`}
              onChange={(e) =>
                onChange(
                  options.map((o) =>
                    o.id === option.id ? { ...o, label: e.target.value } : o,
                  ),
                )
              }
              onKeyDown={(e) => {
                // Enter adds the next option in place, Tally/Typeform style;
                // Backspace on an empty row deletes it and refocuses up.
                if (e.key === "Enter") {
                  e.preventDefault();
                  insertAfter(i, [""]);
                }
                if (e.key === "Backspace" && option.label === "" && options.length > 1) {
                  e.preventDefault();
                  pendingFocus.current = options[Math.max(0, i - 1)].id;
                  onChange(options.filter((o) => o.id !== option.id));
                }
              }}
              onPaste={(e) => {
                // Bulk insert: pasting one-per-line text expands into rows —
                // the first line lands in this row, the rest become new
                // options after it.
                const text = e.clipboardData.getData("text");
                if (!text.includes("\n")) return;
                e.preventDefault();
                const [first, ...rest] = text
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (!first) return;
                const created = rest.map((label) => ({ id: newFieldId(), label }));
                const next = options.map((o) =>
                  o.id === option.id ? { ...o, label: option.label + first } : o,
                );
                next.splice(i + 1, 0, ...created);
                if (created.length > 0) {
                  pendingFocus.current = created[created.length - 1].id;
                }
                onChange(next);
              }}
              className="h-8 flex-1"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label="Move option up"
            >
              <ChevronDown className="size-3 rotate-180" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => move(i, 1)}
              disabled={i === options.length - 1}
              aria-label="Move option down"
            >
              <ChevronDown className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onChange(options.filter((o) => o.id !== option.id))}
              disabled={options.length <= 1}
              aria-label="Remove option"
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          onClick={() => insertAfter(options.length - 1, [""])}
        >
          <Plus data-slot="icon" />
          Add option
        </Button>
        <span className="text-xs text-muted-foreground">
          Enter adds the next · paste a list to bulk-add
        </span>
      </div>
    </div>
  );
}
