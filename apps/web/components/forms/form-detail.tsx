"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Link2,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormRenderer } from "./form-renderer";
import {
  AiEditPopover,
  SourcePicker,
  type BuilderShared,
} from "./form-builder-extras";
import { FormStatusBadge } from "./status-badge";
import { updateForm, deleteForm } from "./actions";
import {
  FIELD_TYPE_META,
  FORM_FIELD_TYPES,
  FormFileValueZod,
  formatAnswer,
  inputFields,
  newFieldId,
  parseFormSchema,
  type FormAnswers,
  type FormAnswerValue,
  type FormField,
  type FormFieldType,
  type FormSchema,
} from "@/lib/forms/schema";
import type { FormResponseSource, FormStatus } from "@/lib/db/types";

export type FormRow = {
  id: string;
  property_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  schema: unknown;
  status: FormStatus;
  allow_multiple: boolean;
  anonymous: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ResponseRow = {
  id: string;
  answers: FormAnswers;
  source: FormResponseSource;
  created_at: string;
  respondent: { id: string; name: string | null } | null;
};

/**
 * Form detail — Build / Responses / Settings tabs under a shared header.
 * The builder edits a local copy of the schema and saves explicitly;
 * settings write through immediately. `canEdit` mirrors the RLS update
 * policy (creator or owner/manager) — without it the builder is read-only
 * preview and Settings is hidden.
 */
export function FormDetail({
  propertyId,
  form,
  canEdit,
}: {
  propertyId: string;
  form: FormRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"build" | "responses" | "settings">("build");
  const [title, setTitle] = useState(form.title);
  const [status, setStatus] = useState<FormStatus>(form.status);
  const [savingStatus, startStatusTransition] = useTransition();

  function saveTitle() {
    const next = title.trim();
    if (!next || next === form.title) {
      setTitle(form.title);
      return;
    }
    void updateForm({ formId: form.id, patch: { title: next } }).then((result) => {
      if ("error" in result) {
        toast.error(result.error);
        setTitle(form.title);
      } else {
        router.refresh();
      }
    });
  }

  function setFormStatus(next: FormStatus) {
    startStatusTransition(async () => {
      const result = await updateForm({ formId: form.id, patch: { status: next } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStatus(next);
      toast.success(
        next === "published"
          ? "Form published"
          : next === "closed"
            ? "Form closed"
            : "Form moved back to draft",
      );
      router.refresh();
    });
  }

  function copyFillLink() {
    const url = `${window.location.origin}/p/${propertyId}/forms/${form.id}/fill`;
    void navigator.clipboard.writeText(url).then(() => {
      toast.success("Fill link copied");
    });
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-6 pt-8 pb-16 sm:px-10">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href={`/p/${propertyId}/forms`}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Back to forms"
        >
          <ArrowLeft className="size-4" />
        </Link>
        {form.icon ? <span className="text-xl">{form.icon}</span> : null}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setTitle(form.title);
          }}
          disabled={!canEdit}
          aria-label="Form title"
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground disabled:pointer-events-none"
          placeholder="Untitled form"
        />
        <FormStatusBadge status={status} />
        <Button variant="outline" size="sm" onClick={copyFillLink}>
          <Link2 data-slot="icon" />
          Copy fill link
        </Button>
        {canEdit && status === "draft" ? (
          <Button size="sm" onClick={() => setFormStatus("published")} disabled={savingStatus}>
            Publish
          </Button>
        ) : null}
      </header>

      <Tabs
        value={tab}
        onValueChange={(t) => setTab(t as typeof tab)}
        className="mt-6 flex flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="responses">Responses</TabsTrigger>
          {canEdit ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="build" className="mt-4">
          <BuildTab propertyId={propertyId} form={form} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="responses" className="mt-4">
          <ResponsesTab propertyId={propertyId} form={form} />
        </TabsContent>
        {canEdit ? (
          <TabsContent value="settings" className="mt-4">
            <SettingsTab
              propertyId={propertyId}
              form={form}
              status={status}
              savingStatus={savingStatus}
              onStatusChange={setFormStatus}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

/* ------------------------------- Build tab ------------------------------- */

function BuildTab({
  propertyId,
  form,
  canEdit,
}: {
  propertyId: string;
  form: FormRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [schema, setSchema] = useState<FormSchema>(() => parseFormSchema(form.schema));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(parseFormSchema(form.schema)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const dirty = JSON.stringify(schema) !== savedJson;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function patchField(id: string, patch: Partial<FormField>) {
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }

  function addField(type: FormFieldType) {
    const field: FormField = {
      id: newFieldId(),
      type,
      label: FIELD_TYPE_META[type].label,
      ...(type === "select" || type === "multi_select"
        ? {
            options: [
              { id: newFieldId(), label: "Option 1" },
              { id: newFieldId(), label: "Option 2" },
            ],
          }
        : null),
    };
    setSchema((prev) => ({ ...prev, fields: [...prev.fields, field] }));
    setSelectedId(field.id);
  }

  function duplicateField(id: string) {
    setSchema((prev) => {
      const index = prev.fields.findIndex((f) => f.id === id);
      if (index < 0) return prev;
      const original = prev.fields[index];
      const copy: FormField = {
        ...original,
        id: newFieldId(),
        options: original.options?.map((o) => ({ ...o, id: newFieldId() })),
      };
      const fields = [...prev.fields];
      fields.splice(index + 1, 0, copy);
      return { ...prev, fields };
    });
  }

  function removeField(id: string) {
    setSchema((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  function reorder(activeFieldId: string, overFieldId: string) {
    setSchema((prev) => {
      const oldIndex = prev.fields.findIndex((f) => f.id === activeFieldId);
      const newIndex = prev.fields.findIndex((f) => f.id === overFieldId);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return { ...prev, fields: arrayMove(prev.fields, oldIndex, newIndex) };
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorder(String(active.id), String(over.id));
  }

  function save() {
    startSave(async () => {
      const result = await updateForm({ formId: form.id, patch: { schema } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSavedJson(JSON.stringify(schema));
      toast.success("Form saved");
      router.refresh();
    });
  }

  const activeField = activeId ? schema.fields.find((f) => f.id === activeId) : null;

  const shared: BuilderShared = {
    propertyId,
    formId: form.id,
    canEdit,
    schema,
    selectedId,
    setSelectedId,
    patchField,
    addField,
    duplicateField,
    removeField,
    reorder,
    applySchema: setSchema,
    dirty,
    saving,
    save,
  };

  return (
    <SplitPanesBuilder
      shared={shared}
      sensors={sensors}
      activeField={activeField ?? null}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    />
  );
}

/* ==================== Variant A — Split panes (current) =================== */

function SplitPanesBuilder({
  shared,
  sensors,
  activeField,
  onDragStart,
  onDragEnd,
  onDragCancel,
}: {
  shared: BuilderShared;
  sensors: ReturnType<typeof useSensors>;
  activeField: FormField | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
}) {
  const {
    schema,
    canEdit,
    selectedId,
    setSelectedId,
    patchField,
    addField,
    removeField,
    dirty,
    saving,
    save,
  } = shared;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {canEdit ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Fields</h2>
            <div className="flex gap-2">
              <AddFieldMenu onAdd={addField} />
              <AiEditPopover shared={shared} />
              <Button size="sm" onClick={save} disabled={!dirty || saving}>
                {saving ? <Loader2 data-slot="icon" className="animate-spin" /> : null}
                {saving ? "Saving…" : dirty ? "Save" : "Saved"}
              </Button>
            </div>
          </div>

          {schema.fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No fields yet — add one to get started.
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
            >
              <SortableContext
                items={schema.fields.map((f) => f.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-1.5">
                  {schema.fields.map((field) => (
                    <SortableFieldRow
                      key={field.id}
                      field={field}
                      propertyId={shared.propertyId}
                      selected={selectedId === field.id}
                      onSelect={() =>
                        setSelectedId(selectedId === field.id ? null : field.id)
                      }
                      onPatch={(patch) => patchField(field.id, patch)}
                      onRemove={() => removeField(field.id)}
                    />
                  ))}
                </div>
              </SortableContext>
              <PortalDragOverlay>
                {activeField ? (
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium shadow-md">
                    {activeField.label}
                  </div>
                ) : null}
              </PortalDragOverlay>
            </DndContext>
          )}
        </div>
      ) : null}

      <div className={cn("flex flex-col gap-3", !canEdit && "lg:col-span-2 lg:mx-auto lg:w-full lg:max-w-xl")}>
        <h2 className="text-sm font-semibold">Preview</h2>
        <div className="rounded-lg border border-border bg-background p-5">
          {schema.fields.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              The form preview appears here as you add fields.
            </p>
          ) : (
            <FormRenderer
              schema={schema}
              onSubmit={async () => ({ ok: true })}
              disabled
              propertyId={shared.propertyId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AddFieldMenu({ onAdd }: { onAdd: (type: FormFieldType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Plus data-slot="icon" />
        Add field
        <ChevronDown className="size-3.5 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
        {FORM_FIELD_TYPES.map((type) => (
          <DropdownMenuItem key={type} onClick={() => onAdd(type)}>
            <div>
              <div className="text-sm font-medium">{FIELD_TYPE_META[type].label}</div>
              <div className="text-xs text-muted-foreground">
                {FIELD_TYPE_META[type].description}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortableFieldRow({
  field,
  propertyId,
  selected,
  onSelect,
  onPatch,
  onRemove,
}: {
  field: FormField;
  propertyId: string;
  selected: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<FormField>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-lg border border-border bg-background",
        isDragging && "opacity-50",
        selected && "border-ring",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className="flex w-full cursor-pointer items-center gap-2 px-2 py-2 text-left"
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label="Reorder field"
          className="cursor-grab touch-none rounded p-0.5 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
          {FIELD_TYPE_META[field.type].label}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {field.label || "Untitled field"}
        </span>
        {field.required ? (
          <span className="size-1.5 shrink-0 rounded-full bg-destructive" title="Required" />
        ) : null}
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground/60 transition-transform",
            selected && "rotate-90",
          )}
        />
      </div>

      {selected ? (
        <FieldEditor
          field={field}
          propertyId={propertyId}
          onPatch={onPatch}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  propertyId,
  onPatch,
  onRemove,
}: {
  field: FormField;
  propertyId: string;
  onPatch: (patch: Partial<FormField>) => void;
  onRemove: () => void;
}) {
  const isChoice = field.type === "select" || field.type === "multi_select";
  const hasPlaceholder = ["short_text", "long_text", "email", "phone", "number"].includes(
    field.type,
  );

  return (
    <div className="space-y-3 border-t border-border px-3 py-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Label</Label>
        <Input
          value={field.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          className="h-8"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Description</Label>
        <Input
          value={field.description ?? ""}
          onChange={(e) => onPatch({ description: e.target.value || undefined })}
          placeholder="Optional helper text"
          className="h-8"
        />
      </div>
      {hasPlaceholder ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Placeholder</Label>
          <Input
            value={field.placeholder ?? ""}
            onChange={(e) => onPatch({ placeholder: e.target.value || undefined })}
            placeholder="Optional"
            className="h-8"
          />
        </div>
      ) : null}

      {isChoice ? (
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

      {field.type === "number" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Min</Label>
            <Input
              type="number"
              value={field.min ?? ""}
              onChange={(e) =>
                onPatch({ min: e.target.value === "" ? undefined : Number(e.target.value) })
              }
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Max</Label>
            <Input
              type="number"
              value={field.max ?? ""}
              onChange={(e) =>
                onPatch({ max: e.target.value === "" ? undefined : Number(e.target.value) })
              }
              className="h-8"
            />
          </div>
        </div>
      ) : null}

      {field.type === "rating" ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Scale (3–10)</Label>
          <Input
            type="number"
            min={3}
            max={10}
            value={field.maxRating ?? 5}
            onChange={(e) => {
              const n = Number(e.target.value);
              onPatch({
                maxRating: Number.isInteger(n)
                  ? Math.min(10, Math.max(3, n))
                  : undefined,
              });
            }}
            className="h-8 w-24"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between pt-1">
        {field.type !== "section" ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={field.required ?? false}
              onCheckedChange={() => onPatch({ required: !field.required })}
              aria-label={`${field.label} required`}
            />
            Required
          </label>
        ) : (
          <span />
        )}
        <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
          <Trash2 data-slot="icon" />
          Remove
        </Button>
      </div>
    </div>
  );
}

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
      <Label className="text-xs">Options</Label>
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

/* ----------------------------- Responses tab ----------------------------- */

const MAX_VISIBLE_COLUMNS = 5;

function ResponsesTab({ propertyId, form }: { propertyId: string; form: FormRow }) {
  const schema = useMemo(() => parseFormSchema(form.schema), [form.schema]);
  const fields = useMemo(() => inputFields(schema), [schema]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isPending, error } = useQuery({
    queryKey: ["form-responses", form.id],
    queryFn: async (): Promise<ResponseRow[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/forms/${form.id}/responses`,
      );
      const body = (await res.json()) as { responses?: ResponseRow[]; error?: string };
      if (!res.ok || !body.responses) throw new Error(body.error ?? "Failed to load");
      return body.responses;
    },
  });

  if (isPending) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading responses…</p>;
  }
  if (error) {
    return (
      <p className="py-12 text-center text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load responses"}
      </p>
    );
  }

  const responses = data ?? [];
  if (responses.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center">
        <p className="text-sm font-medium">No responses yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {form.status === "published"
            ? "Share the fill link to start collecting."
            : "Publish the form to start collecting."}
        </p>
      </div>
    );
  }

  const visible = fields.slice(0, MAX_VISIBLE_COLUMNS);
  const hasMore = fields.length > MAX_VISIBLE_COLUMNS;
  const latest = responses[0]?.created_at;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 text-sm">
        <span className="font-semibold">
          {responses.length} {responses.length === 1 ? "response" : "responses"}
        </span>
        {latest ? (
          <span className="text-xs text-muted-foreground">
            Latest {formatDate(latest)}
          </span>
        ) : null}
      </div>

      <SummaryStrip fields={fields} responses={responses} />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              {hasMore ? <th className="w-8 px-2 py-2" /> : null}
              <th className="px-3 py-2 font-medium">Respondent</th>
              {visible.map((f) => (
                <th key={f.id} className="max-w-44 truncate px-3 py-2 font-medium">
                  {f.label}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {responses.map((r) => (
              <ResponseRows
                key={r.id}
                response={r}
                visible={visible}
                allFields={fields}
                hasMore={hasMore}
                expanded={expanded.has(r.id)}
                onToggle={() => toggle(r.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResponseRows({
  response,
  visible,
  allFields,
  hasMore,
  expanded,
  onToggle,
}: {
  response: ResponseRow;
  visible: FormField[];
  allFields: FormField[];
  hasMore: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colSpan = visible.length + 2 + (hasMore ? 1 : 0);
  return (
    <>
      <tr className="border-b border-border last:border-0">
        {hasMore ? (
          <td className="px-2 py-2">
            <button
              type="button"
              onClick={onToggle}
              aria-label={expanded ? "Collapse row" : "Expand row"}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
          </td>
        ) : null}
        <td className="px-3 py-2 whitespace-nowrap">
          {response.respondent?.name ?? "Anonymous"}
        </td>
        {visible.map((f) => (
          <td key={f.id} className="max-w-44 truncate px-3 py-2">
            <AnswerCell field={f} value={response.answers[f.id]} />
          </td>
        ))}
        <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(response.created_at)}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border bg-muted/30 last:border-0">
          <td colSpan={colSpan} className="px-4 py-3">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {allFields.map((f) => (
                <div key={f.id}>
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="text-sm">
                    <AnswerCell field={f} value={response.answers[f.id]} />
                  </dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * One answer in the responses view — file answers render as links to the
 * uploaded objects (the bucket is public); everything else goes through
 * formatAnswer().
 */
function AnswerCell({
  field,
  value,
}: {
  field: FormField;
  value: FormAnswerValue | undefined;
}) {
  if (field.type === "file" && Array.isArray(value)) {
    const files = value
      .map((v) => FormFileValueZod.safeParse(v))
      .filter((r) => r.success)
      .map((r) => r.data);
    if (files.length === 0) return <>—</>;
    return (
      <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
        {files.map((f, i) => (
          <a
            key={`${f.url}-${i}`}
            href={f.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {f.name}
          </a>
        ))}
      </span>
    );
  }
  return <>{formatAnswer(field, value)}</>;
}

/** Per-field aggregates for choice/rating/yes-no fields — quick read on the
 *  distribution before scanning the table. */
function SummaryStrip({
  fields,
  responses,
}: {
  fields: FormField[];
  responses: ResponseRow[];
}) {
  const summaries = fields
    .map((field) => {
      if (field.type === "rating") {
        const values = responses
          .map((r) => r.answers[field.id])
          .filter((v): v is number => typeof v === "number");
        if (values.length === 0) return null;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        return { field, kind: "rating" as const, avg, count: values.length };
      }
      if (field.type === "select" || field.type === "multi_select" || field.type === "yes_no") {
        const labels =
          field.type === "yes_no"
            ? [
                { id: "yes", label: "Yes" },
                { id: "no", label: "No" },
              ]
            : (field.options ?? []);
        const counts = new Map<string, number>(labels.map((o) => [o.id, 0]));
        for (const r of responses) {
          const v = r.answers[field.id];
          const picked =
            field.type === "yes_no"
              ? v === true
                ? ["yes"]
                : v === false
                  ? ["no"]
                  : []
              : Array.isArray(v)
                ? v.filter((x): x is string => typeof x === "string")
                : typeof v === "string"
                  ? [v]
                  : [];
          for (const id of picked) {
            if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
          }
        }
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        if (total === 0) return null;
        return { field, kind: "choices" as const, labels, counts, total };
      }
      return null;
    })
    .filter((s) => s !== null);

  if (summaries.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {summaries.map((s) => (
        <div
          key={s.field.id}
          className="w-56 shrink-0 rounded-lg border border-border bg-background p-3"
        >
          <p className="truncate text-xs font-medium">{s.field.label}</p>
          {s.kind === "rating" ? (
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {s.avg.toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground">
                /{s.field.maxRating ?? 5} avg · {s.count}
              </span>
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {s.labels.map((opt) => {
                const count = s.counts.get(opt.id) ?? 0;
                const pct = s.total > 0 ? (count / s.total) * 100 : 0;
                return (
                  <div key={opt.id} className="text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-muted-foreground">{opt.label}</span>
                      <span className="shrink-0 tabular-nums">{count}</span>
                    </div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------- Settings tab ------------------------------ */

function SettingsTab({
  propertyId,
  form,
  status,
  savingStatus,
  onStatusChange,
}: {
  propertyId: string;
  form: FormRow;
  status: FormStatus;
  savingStatus: boolean;
  onStatusChange: (status: FormStatus) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description ?? "");
  const [icon, setIcon] = useState(form.icon ?? "");
  const [allowMultiple, setAllowMultiple] = useState(form.allow_multiple);
  const [anonymous, setAnonymous] = useState(form.anonymous);
  const [saving, startSave] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();

  const metaDirty =
    title.trim() !== form.title ||
    (description.trim() || null) !== form.description ||
    (icon.trim() || null) !== form.icon;

  function saveMeta() {
    startSave(async () => {
      const result = await updateForm({
        formId: form.id,
        patch: {
          title: title.trim() || form.title,
          description: description.trim() || null,
          icon: icon.trim() || null,
        },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Form updated");
      router.refresh();
    });
  }

  function toggleField(key: "allow_multiple" | "anonymous", next: boolean) {
    const revert = key === "allow_multiple" ? setAllowMultiple : setAnonymous;
    revert(next);
    void updateForm({ formId: form.id, patch: { [key]: next } }).then((result) => {
      if ("error" in result) {
        toast.error(result.error);
        revert(!next);
      } else {
        router.refresh();
      }
    });
  }

  function remove() {
    startDelete(async () => {
      const result = await deleteForm(form.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Form deleted");
      router.push(`/p/${propertyId}/forms`);
    });
  }

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="form-title">Title</Label>
          <Input
            id="form-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="form-description">Description</Label>
          <Textarea
            id="form-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown to respondents above the form"
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="form-icon">Icon</Label>
          <Input
            id="form-icon"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="An emoji, e.g. 🛠️"
            className="w-32"
            maxLength={16}
          />
        </div>
        <Button size="sm" onClick={saveMeta} disabled={!metaDirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </section>

      <hr className="border-border" />

      <section className="space-y-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Allow multiple responses</span>
            <span className="block text-xs text-muted-foreground">
              Each member can submit more than once (e.g. a request form).
            </span>
          </span>
          <Switch
            checked={allowMultiple}
            onCheckedChange={() => toggleField("allow_multiple", !allowMultiple)}
            aria-label="Allow multiple responses"
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Anonymous responses</span>
            <span className="block text-xs text-muted-foreground">
              Never store who submitted — for honest staff feedback.
            </span>
          </span>
          <Switch
            checked={anonymous}
            onCheckedChange={() => toggleField("anonymous", !anonymous)}
            aria-label="Anonymous responses"
          />
        </label>
      </section>

      <hr className="border-border" />

      <section className="space-y-3">
        <div>
          <p className="text-sm font-medium">Status</p>
          <p className="text-xs text-muted-foreground">
            Only published forms accept responses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status !== "published" ? (
            <Button size="sm" onClick={() => onStatusChange("published")} disabled={savingStatus}>
              Publish
            </Button>
          ) : null}
          {status === "published" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatusChange("draft")}
              disabled={savingStatus}
            >
              Unpublish
            </Button>
          ) : null}
          {status !== "closed" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatusChange("closed")}
              disabled={savingStatus}
            >
              Close
            </Button>
          ) : null}
        </div>
      </section>

      <hr className="border-border" />

      <section className="space-y-3">
        <div>
          <p className="text-sm font-medium">Danger zone</p>
          <p className="text-xs text-muted-foreground">
            Deleting a form removes all of its responses.
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 data-slot="icon" />
          Delete form
        </Button>
      </section>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete form?</DialogTitle>
            <DialogDescription>
              &ldquo;{form.title}&rdquo; and all of its responses will be
              permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------- helpers -------------------------------- */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

