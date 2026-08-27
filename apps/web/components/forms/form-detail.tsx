"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlignLeft,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Eye,
  GitBranch,
  GripVertical,
  Hash,
  Heading,
  Info,
  Layers,
  Link2,
  Loader2,
  Mail,
  Paperclip,
  PenLine,
  Phone,
  Plus,
  Search,
  Star,
  Tags,
  ToggleLeft,
  Trash2,
  Type,
  UserRound,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { EmptyState } from "@/components/ui/empty-state";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FormFieldInput, FormRenderer } from "./form-renderer";
import {
  AiEditPopover,
  SourcePicker,
  type BuilderShared,
  type FieldPreset,
} from "./form-builder-extras";
import { FORM_BACKGROUND_CLASSES, FORM_BACKGROUND_LABELS } from "./backgrounds";
import { FormStatusBadge } from "./status-badge";
import { TaskAutomationCard } from "./task-automation-card";
import { updateForm, deleteForm } from "./actions";
import {
  CONDITION_OPS,
  FIELD_TYPE_META,
  FORM_BACKGROUNDS,
  FormFileValueZod,
  PRIORITY_FIELD_OPTIONS,
  TASK_PROPERTY_META,
  formatAnswer,
  inputFields,
  newFieldId,
  parseFormSchema,
  type ConditionOp,
  type FormAnswers,
  type FormAnswerValue,
  type FormField,
  type FormFieldCondition,
  type FormSchema,
  type FormSettings,
  type TaskPropertyKind,
} from "@/lib/forms/schema";
import type { FormResponseSource, FormStatus } from "@/lib/db/types";
import { PageShell } from "@/components/ui/page-shell";

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

type ResponsesPayload = {
  responses: ResponseRow[];
  /** fieldId → (answer id → display label) for sourced choice/people fields. */
  sourcedLabels: Record<string, Record<string, string>>;
};

function responsesQueryOptions(propertyId: string, formId: string) {
  return {
    queryKey: ["form-responses", formId],
    queryFn: async (): Promise<ResponsesPayload> => {
      const res = await fetch(`/api/properties/${propertyId}/forms/${formId}/responses`);
      const body = (await res.json()) as Partial<ResponsesPayload> & { error?: string };
      if (!res.ok || !body.responses) throw new Error(body.error ?? "Failed to load");
      return { responses: body.responses, sourcedLabels: body.sourcedLabels ?? {} };
    },
  };
}

/**
 * Form detail — ClickUp-style Build / Settings / Preview tabs plus a
 * "N responses" chip, under a shared header. The schema working copy lives
 * HERE (not in the Build tab) so Build edits, presentation Settings, and the
 * Preview tab all see the same unsaved state and share one Save. Settings
 * that are DB columns (status, allow multiple, anonymous) write through
 * immediately as before. `canEdit` mirrors the RLS update policy (creator or
 * owner/manager) — without it only Preview and Responses show.
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
  const [tab, setTab] = useState<"build" | "responses" | "settings" | "preview">(
    canEdit ? "build" : "preview",
  );
  const [title, setTitle] = useState(form.title);
  const [status, setStatus] = useState<FormStatus>(form.status);
  const [savingStatus, startStatusTransition] = useTransition();

  // The shared schema working copy (fields + presentation settings).
  const [schema, setSchema] = useState<FormSchema>(() => parseFormSchema(form.schema));
  const [savedJson, setSavedJson] = useState(() =>
    JSON.stringify(parseFormSchema(form.schema)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const dirty = JSON.stringify(schema) !== savedJson;

  const { data: responsesData } = useQuery(responsesQueryOptions(propertyId, form.id));
  const responseCount = responsesData?.responses.length;

  function patchField(id: string, patch: Partial<FormField>) {
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }

  function addField(preset: FieldPreset) {
    const isChoice = preset.type === "select" || preset.type === "multi_select";
    const field: FormField = {
      id: newFieldId(),
      type: preset.type,
      label: preset.label ?? FIELD_TYPE_META[preset.type].label,
      ...(preset.description ? { description: preset.description } : {}),
      ...(preset.placeholder ? { placeholder: preset.placeholder } : {}),
      ...(preset.taskProperty ? { taskProperty: preset.taskProperty } : {}),
      ...(preset.source ? { source: preset.source } : {}),
      ...(preset.options
        ? { options: preset.options }
        : isChoice && !preset.source
          ? {
              options: [
                { id: newFieldId(), label: "Option 1" },
                { id: newFieldId(), label: "Option 2" },
              ],
            }
          : {}),
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
        // Task-property presets carry semantic option ids ("urgent") — only
        // regenerate ids for plain custom lists.
        options: original.taskProperty
          ? original.options
          : original.options?.map((o) => ({ ...o, id: newFieldId() })),
      };
      const fields = [...prev.fields];
      fields.splice(index + 1, 0, copy);
      return { ...prev, fields };
    });
  }

  function removeField(id: string) {
    setSchema((prev) => ({
      ...prev,
      // Conditions referencing a deleted field fail open at render time; drop
      // them here so the builder never shows a stale rule.
      fields: prev.fields
        .filter((f) => f.id !== id)
        .map((f) => (f.condition?.fieldId === id ? { ...f, condition: undefined } : f)),
    }));
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

  function patchSettings(patch: Partial<FormSettings>) {
    setSchema((prev) => {
      const settings = { ...(prev.settings ?? {}), ...patch };
      // Drop empty keys so an untouched form keeps a clean schema.
      for (const key of Object.keys(settings) as (keyof FormSettings)[]) {
        if (settings[key] === undefined || settings[key] === "") delete settings[key];
      }
      return {
        ...prev,
        settings: Object.keys(settings).length > 0 ? settings : undefined,
      };
    });
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
    <PageShell className="flex h-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href={`/p/${propertyId}/forms`}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
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
          className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground disabled:pointer-events-none"
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
        <div className="flex flex-wrap items-center gap-3">
          {/* ClickUp's "0 responses" chip — doubles as the Responses tab. */}
          <TabsList>
            <TabsTrigger value="responses">
              {responseCount === undefined
                ? "Responses"
                : `${responseCount} ${responseCount === 1 ? "response" : "responses"}`}
            </TabsTrigger>
          </TabsList>
          <TabsList className="mx-auto">
            {canEdit ? <TabsTrigger value="build">Build</TabsTrigger> : null}
            {canEdit ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          {/* Spacer balances the chip so the tab strip sits centered. */}
          <div className="hidden w-28 sm:block" aria-hidden />
        </div>

        {canEdit ? (
          <TabsContent value="build" className="mt-4">
            <BuildTab
              shared={shared}
              title={title}
              description={form.description}
              icon={form.icon}
            />
          </TabsContent>
        ) : null}
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
              shared={shared}
              onPatchSettings={patchSettings}
            />
          </TabsContent>
        ) : null}
        <TabsContent value="preview" className="mt-4">
          <PreviewTab
            title={title}
            description={form.description}
            icon={form.icon}
            schema={schema}
            propertyId={propertyId}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/* ------------------------------- Build tab ------------------------------- */

/**
 * ClickUp-style WYSIWYG builder: ONE centered canvas where every question
 * renders as its real preview (the same `FormFieldInput` the fill page
 * uses). Hovering a question reveals the drag handle and an "Edit question"
 * hint; clicking selects it and the editor expands inside the card. No
 * separate fields-list/preview panes.
 */
function BuildTab({
  shared,
  title,
  description,
  icon,
}: {
  shared: BuilderShared;
  title: string;
  description: string | null;
  icon: string | null;
}) {
  const router = useRouter();
  const {
    schema,
    selectedId,
    setSelectedId,
    patchField,
    addField,
    removeField,
    dirty,
    saving,
    save,
  } = shared;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [desc, setDesc] = useState(description ?? "");
  const twoColumn = schema.settings?.layout === "two";

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    // An expanded editor mid-list makes drop targets jump around — collapse
    // it for the duration of the drag.
    setSelectedId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    shared.reorder(String(active.id), String(over.id));
  }

  function saveDescription() {
    const next = desc.trim();
    if (next === (description ?? "")) return;
    void updateForm({ formId: shared.formId, patch: { description: next || null } }).then(
      (result) => {
        if ("error" in result) {
          toast.error(result.error);
          setDesc(description ?? "");
        } else {
          router.refresh();
        }
      },
    );
  }

  const activeField = activeId ? schema.fields.find((f) => f.id === activeId) : null;

  return (
    // One centered measure for the whole tab — toolbar, header, questions and
    // the add bar all share the same left edge. The horizontal padding is the
    // margin the hover grip hangs into.
    <div className="mx-auto w-full max-w-2xl px-8">
      <div className="flex items-center justify-end gap-2 py-1">
        <AddQuestionMenu
          onAdd={addField}
          trigger={
            <Button variant="outline" size="sm">
              <Plus data-slot="icon" />
              Add question
              <ChevronDown className="size-3.5 opacity-50" />
            </Button>
          }
        />
        <AiEditPopover shared={shared} />
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 data-slot="icon" className="animate-spin" /> : null}
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </Button>
      </div>

      <div className="py-6">
        {/* Header text shares the 16px inset the question cards give their
            content, so the canvas reads as one column of blocks. */}
        <header className="mb-6 flex flex-col items-start gap-3 px-4">
          {icon ? (
            <div className="flex size-14 items-center justify-center rounded-md bg-muted text-3xl">
              {icon}
            </div>
          ) : null}
          <h2 className="text-2xl font-semibold text-balance">{title}</h2>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={saveDescription}
            rows={desc.length > 120 ? 3 : 1}
            placeholder="Add a description for respondents…"
            aria-label="Form description"
            className="w-full resize-none bg-transparent text-base leading-relaxed text-foreground/80 outline-none placeholder:text-muted-foreground/70"
          />
        </header>

        {schema.fields.length === 0 ? (
          <EmptyState
            title="No questions yet"
            action={
              <AddQuestionMenu
                onAdd={addField}
                trigger={
                  <Button variant="outline" size="sm">
                    <Plus data-slot="icon" />
                    Add question
                  </Button>
                }
              />
            }
          >
            Every question you add shows here exactly as respondents will see
            it.
          </EmptyState>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            // Cards vary in height (sections vs dropzones vs signatures), so
            // remeasure while dragging — stale rects are what made drops land
            // one slot off.
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            modifiers={twoColumn ? undefined : [restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext
              items={schema.fields.map((f) => f.id)}
              strategy={twoColumn ? rectSortingStrategy : verticalListSortingStrategy}
            >
              <div
                className={cn(
                  twoColumn
                    ? "grid grid-cols-1 gap-1 gap-x-4 sm:grid-cols-2"
                    : "flex flex-col gap-1",
                )}
              >
                {schema.fields.map((field) => (
                  <CanvasFieldCard
                    key={field.id}
                    field={field}
                    schema={schema}
                    propertyId={shared.propertyId}
                    twoColumn={twoColumn}
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
            {/* The overlay IS the card (same preview markup, floating-chrome
                elevation); the in-list original hides so only one copy shows. */}
            <PortalDragOverlay>
              {activeField ? (
                <div className="cursor-grabbing rounded-card bg-popover px-4 py-3 shadow-popover">
                  <FieldPreviewBlock
                    field={activeField}
                    propertyId={shared.propertyId}
                  />
                </div>
              ) : null}
            </PortalDragOverlay>
          </DndContext>
        )}

        {/* ClickUp's big bottom "Add question" bar. */}
        <div className="mt-6">
          <AddQuestionMenu
            onAdd={addField}
            trigger={
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-md bg-muted px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Plus className="size-4" />
                Add question
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------- Add-question menu ---------------------------- */

type MenuLeaf = {
  key: string;
  label: string;
  icon: LucideIcon;
  preset: FieldPreset;
};

type MenuEntry =
  | MenuLeaf
  | { key: string; label: string; icon: LucideIcon; children: MenuLeaf[] };

const TASK_PROPERTY_LEAVES: MenuLeaf[] = [
  {
    key: "tp-assignee",
    label: "Assignee",
    icon: UserRound,
    preset: { type: "people", label: "Assignee", taskProperty: "assignee" },
  },
  {
    key: "tp-priority",
    label: "Priority",
    icon: Layers,
    preset: {
      type: "select",
      label: "Priority",
      taskProperty: "priority",
      options: PRIORITY_FIELD_OPTIONS.map((o) => ({ ...o })),
    },
  },
  {
    key: "tp-due-date",
    label: "Due date",
    icon: CalendarDays,
    preset: { type: "date", label: "Due date", taskProperty: "due_date" },
  },
  {
    key: "tp-tags",
    label: "Tags",
    icon: Tags,
    preset: {
      type: "multi_select",
      label: "Tags",
      taskProperty: "labels",
      source: { kind: "labels" },
    },
  },
];

const QUESTION_MENU: { section: string; entries: MenuEntry[] }[] = [
  {
    section: "Questions type",
    entries: [
      {
        key: "task-property",
        label: "Task property",
        icon: Layers,
        children: TASK_PROPERTY_LEAVES,
      },
      { key: "short_text", label: "Short text", icon: Type, preset: { type: "short_text" } },
      { key: "long_text", label: "Long text", icon: AlignLeft, preset: { type: "long_text" } },
      { key: "date", label: "Dates", icon: CalendarDays, preset: { type: "date" } },
      { key: "select", label: "Single-select", icon: CircleDot, preset: { type: "select" } },
      { key: "multi_select", label: "Multi-select", icon: Tags, preset: { type: "multi_select" } },
      {
        key: "contact",
        label: "Contact info",
        icon: Phone,
        children: [
          { key: "email", label: "Email", icon: Mail, preset: { type: "email" } },
          { key: "phone", label: "Phone", icon: Phone, preset: { type: "phone" } },
        ],
      },
      { key: "people", label: "People", icon: UserRound, preset: { type: "people" } },
      { key: "file", label: "Uploads", icon: Paperclip, preset: { type: "file" } },
      { key: "number", label: "Number", icon: Hash, preset: { type: "number" } },
      { key: "rating", label: "Rating", icon: Star, preset: { type: "rating" } },
      { key: "yes_no", label: "Yes / No", icon: ToggleLeft, preset: { type: "yes_no" } },
      { key: "signature", label: "Signature", icon: PenLine, preset: { type: "signature" } },
    ],
  },
  {
    section: "Layout",
    entries: [
      {
        key: "info",
        label: "Information Block",
        icon: Info,
        preset: { type: "info", label: "Add your text here" },
      },
      { key: "section", label: "Section", icon: Heading, preset: { type: "section" } },
    ],
  },
];

/**
 * ClickUp's add-question menu: search on top, categorized list below,
 * "Task property" and "Contact info" expand inline. Searching flattens
 * everything (submenu leaves included).
 */
function AddQuestionMenu({
  onAdd,
  trigger,
}: {
  onAdd: (preset: FieldPreset) => void;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const flatMatches: MenuLeaf[] = q
    ? QUESTION_MENU.flatMap((s) =>
        s.entries.flatMap((e) =>
          "children" in e
            ? e.children.filter(
                (c) =>
                  c.label.toLowerCase().includes(q) ||
                  e.label.toLowerCase().includes(q),
              )
            : e.label.toLowerCase().includes(q)
              ? [e]
              : [],
        ),
      )
    : [];

  function pick(preset: FieldPreset) {
    onAdd(preset);
    setOpen(false);
    setQuery("");
    setExpanded(null);
  }

  function LeafRow({ leaf, indent }: { leaf: MenuLeaf; indent?: boolean }) {
    const IconComponent = leaf.icon;
    return (
      <button
        type="button"
        onClick={() => pick(leaf.preset)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
          indent && "pl-8",
        )}
      >
        <IconComponent className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{leaf.label}</span>
      </button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setExpanded(null);
        }
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-72 p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            autoFocus
            className="h-8 pl-8"
            aria-label="Search question types"
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {q ? (
            flatMatches.length > 0 ? (
              flatMatches.map((leaf) => <LeafRow key={leaf.key} leaf={leaf} />)
            ) : (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No question types match &ldquo;{query}&rdquo;
              </p>
            )
          ) : (
            QUESTION_MENU.map((group) => (
              <div key={group.section} className="mb-1">
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {group.section}
                </p>
                {group.entries.map((entry) =>
                  "children" in entry ? (
                    <div key={entry.key}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded(expanded === entry.key ? null : entry.key)
                        }
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                      >
                        <entry.icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{entry.label}</span>
                        <ChevronRight
                          className={cn(
                            "size-3.5 text-muted-foreground/60 transition-transform",
                            expanded === entry.key && "rotate-90",
                          )}
                        />
                      </button>
                      {expanded === entry.key
                        ? entry.children.map((leaf) => (
                            <LeafRow key={leaf.key} leaf={leaf} indent />
                          ))
                        : null}
                    </div>
                  ) : (
                    <LeafRow key={entry.key} leaf={entry} />
                  ),
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------ Canvas cards ----------------------------- */

/** Wide blocks span both tracks in two-column layout (mirrors the renderer). */
function spansBothColumns(field: FormField): boolean {
  return ["section", "info", "long_text", "file", "signature"].includes(field.type);
}

/**
 * One question on the WYSIWYG canvas: the field's REAL preview, with a
 * hover grip hanging in the left margin, an "Edit question" hint pill, and
 * type badges. Selecting highlights the card and expands the editor inside
 * it — the ClickUp build-tab interaction.
 */
function CanvasFieldCard({
  field,
  schema,
  propertyId,
  twoColumn,
  selected,
  onSelect,
  onPatch,
  onRemove,
}: {
  field: FormField;
  schema: FormSchema;
  propertyId: string;
  twoColumn: boolean;
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
        "group relative",
        // The drag overlay carries the visible copy — the in-list original
        // goes fully transparent so exactly one card follows the cursor and
        // the empty slot marks the drop position.
        isDragging && "opacity-0",
        // The selected card (preview + expanded editor) needs the full row.
        twoColumn && (selected || spansBothColumns(field)) && "sm:col-span-2",
        // Resting question = a Notion block (6px hover wash). Selected
        // question = a surface: 10px radius drawn by the bare warm ring.
        selected ? "rounded-card shadow-ring" : "rounded-md",
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
        aria-label={`Edit question: ${field.label || "Untitled field"}`}
        className={cn(
          "relative w-full cursor-pointer px-4 py-3 text-left transition-colors",
          selected ? "rounded-t-card" : "rounded-md hover:bg-accent",
        )}
      >
        {/* ClickUp's hover hint — styled as the house tooltip (constant dark
            slab on both planes, never bg-foreground which theme-inverts). */}
        {!selected ? (
          <span className="pointer-events-none absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-md bg-tooltip-bg px-2 py-1 text-xs text-tooltip-foreground opacity-0 shadow-tooltip transition-opacity group-hover:opacity-100">
            Edit question
          </span>
        ) : null}

        {/* Drag grip hangs in the left margin, hover/selected only. */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label="Reorder question"
          className={cn(
            "absolute top-3 -left-7 flex size-6 cursor-grab touch-none items-center justify-center rounded-md text-faint-foreground opacity-0 transition-opacity",
            "hover:bg-accent hover:text-foreground active:cursor-grabbing",
            "group-hover:opacity-100 focus-visible:opacity-100",
            selected && "opacity-100",
          )}
        >
          <GripVertical className="size-4" />
        </button>

        {/* Status badges: mapped / conditional — hover affordance rhythm. */}
        {field.taskProperty || field.condition ? (
          <span className="absolute top-3 right-3 flex items-center gap-1.5 text-faint-foreground">
            {field.taskProperty ? (
              <Wand2
                className="size-3.5"
                aria-label={`Sets the task's ${TASK_PROPERTY_META[field.taskProperty].label.toLowerCase()}`}
              />
            ) : null}
            {field.condition ? (
              <GitBranch className="size-3.5" aria-label="Shown conditionally" />
            ) : null}
          </span>
        ) : null}

        <FieldPreviewBlock field={field} propertyId={propertyId} />
      </div>

      {selected ? (
        <FieldEditor
          field={field}
          schema={schema}
          propertyId={propertyId}
          onPatch={onPatch}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  );
}

/**
 * The question exactly as respondents see it (same markup as the page-mode
 * renderer, same `FormFieldInput`), inert: `pointer-events-none` lets every
 * click select the card instead of focusing the control.
 */
function FieldPreviewBlock({
  field,
  propertyId,
}: {
  field: FormField;
  propertyId: string;
}) {
  if (field.type === "section") {
    return (
      <div className="pt-1">
        <h3 className="text-base font-semibold">{field.label}</h3>
        {field.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{field.description}</p>
        ) : null}
      </div>
    );
  }
  if (field.type === "info") {
    return (
      <div>
        <p className="text-base whitespace-pre-line">{field.label}</p>
        {field.description ? (
          <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">
            {field.description}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <span className="flex items-baseline gap-0.5 text-base leading-none font-semibold">
        {field.label || (
          <span className="text-muted-foreground">Untitled question</span>
        )}
        {field.required ? <span className="text-destructive">*</span> : null}
      </span>
      {field.description ? (
        <p className="text-sm text-muted-foreground">{field.description}</p>
      ) : null}
      <div className="pointer-events-none" aria-hidden>
        <FormFieldInput
          field={field}
          value={undefined}
          onChange={() => {}}
          disabled
          large
          propertyId={propertyId}
        />
      </div>
    </div>
  );
}

/** Which task property a field type can map onto. */
const MAPPABLE: Partial<Record<FormField["type"], TaskPropertyKind>> = {
  people: "assignee",
  select: "priority",
  date: "due_date",
  multi_select: "labels",
};

function FieldEditor({
  field,
  schema,
  propertyId,
  onPatch,
  onRemove,
}: {
  field: FormField;
  schema: FormSchema;
  propertyId: string;
  onPatch: (patch: Partial<FormField>) => void;
  onRemove: () => void;
}) {
  const isChoice = field.type === "select" || field.type === "multi_select";
  const isLayout = field.type === "section" || field.type === "info";
  const hasPlaceholder = ["short_text", "long_text", "email", "phone", "number"].includes(
    field.type,
  );
  const mappable = MAPPABLE[field.type];
  const priorityMapped = field.taskProperty === "priority";

  function setTaskProperty(next: string) {
    if (!next) {
      onPatch({ taskProperty: undefined });
      return;
    }
    const kind = next as TaskPropertyKind;
    if (kind === "priority") {
      // Priority options are fixed — their ids ARE the task priority values.
      onPatch({
        taskProperty: kind,
        source: undefined,
        options: PRIORITY_FIELD_OPTIONS.map((o) => ({ ...o })),
      });
      return;
    }
    onPatch({ taskProperty: kind });
  }

  return (
    // Shares the card's 16px content inset so the editor's controls sit on
    // the same left edge as the preview above it.
    <div className="space-y-3 border-t border-border px-4 py-4">
      <div className="space-y-1.5">
        <Label className="text-xs">{field.type === "info" ? "Text" : "Label"}</Label>
        {field.type === "info" ? (
          <Textarea
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            rows={3}
          />
        ) : (
          <Input
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className="h-8"
          />
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">
          {field.type === "info" ? "Secondary text" : "Description"}
        </Label>
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
          Options are the task priorities (Urgent / High / Medium / Low).
        </p>
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

      {mappable ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Maps to task field</Label>
          <NativeSelect
            value={field.taskProperty ?? ""}
            aria-label="Maps to task field"
            onChange={(e) => setTaskProperty(e.target.value)}
          >
            <option value="">Not mapped</option>
            <option value={mappable}>{TASK_PROPERTY_META[mappable].label}</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {field.taskProperty
              ? `${TASK_PROPERTY_META[field.taskProperty].description} — when submissions create tasks.`
              : "Feed this answer into the task created from each submission."}
          </p>
        </div>
      ) : null}

      {!isLayout || field.condition ? (
        <LogicEditor field={field} schema={schema} onPatch={onPatch} />
      ) : null}

      <div className="flex items-center justify-between pt-1">
        {!isLayout ? (
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
      <Label className="text-xs">Logic</Label>
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
          <option value="always">Always visible</option>
          <option value="when">Show only when…</option>
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
  if (controller.type === "yes_no") {
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

const EMPTY_RESPONSES: ResponseRow[] = [];
const EMPTY_SOURCED_LABELS: Record<string, Record<string, string>> = {};

const YES_NO_OPTIONS = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
] as const;

/** The option ids an answer picked, for chip filtering. */
function answerOptionIds(
  field: FormField,
  value: FormAnswerValue | undefined,
): string[] {
  if (field.type === "yes_no") {
    return value === true ? ["yes"] : value === false ? ["no"] : [];
  }
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/** Lowercased haystack for the responses search: respondent name + every
 *  answer's display text (sourced ids map through their resolved labels). */
function responseSearchText(
  response: ResponseRow,
  fields: FormField[],
  sourcedLabels: Record<string, Record<string, string>>,
): string {
  const parts: string[] = [response.respondent?.name ?? "Anonymous"];
  for (const field of fields) {
    const value = response.answers[field.id];
    const labels = sourcedLabels[field.id];
    if (labels && typeof value === "string" && value) {
      parts.push(labels[value] ?? value);
    } else if (labels && Array.isArray(value)) {
      parts.push(
        value
          .filter((v): v is string => typeof v === "string")
          .map((v) => labels[v] ?? v)
          .join(" "),
      );
    } else {
      parts.push(formatAnswer(field, value));
    }
  }
  return parts.join(" ").toLowerCase();
}

function ResponsesTab({ propertyId, form }: { propertyId: string; form: FormRow }) {
  const schema = useMemo(() => parseFormSchema(form.schema), [form.schema]);
  const fields = useMemo(() => inputFields(schema), [schema]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  /** fieldId → selected option id (absent/null = "All"). Single-select. */
  const [chipFilters, setChipFilters] = useState<Record<string, string | null>>({});
  const [sortDir, setSortDir] = useState<"newest" | "oldest">("newest");

  const { data, isPending, error } = useQuery(responsesQueryOptions(propertyId, form.id));
  const responses = data?.responses ?? EMPTY_RESPONSES;
  const sourcedLabels = data?.sourcedLabels ?? EMPTY_SOURCED_LABELS;

  // Chip rows for the first 2 select / yes-no fields that have any answers
  // (the same fields that earn a SummaryStrip tile) — more would be chip soup.
  const chipFields = useMemo(() => {
    const out: {
      field: FormField;
      options: { id: string; label: string }[];
      counts: Map<string, number>;
    }[] = [];
    for (const field of fields) {
      if (out.length >= 2) break;
      if (field.type !== "select" && field.type !== "yes_no") continue;
      const options =
        field.type === "yes_no" ? [...YES_NO_OPTIONS] : (field.options ?? []);
      if (options.length === 0) continue; // sourced selects have no stored options
      const counts = new Map<string, number>(options.map((o) => [o.id, 0]));
      let total = 0;
      for (const r of responses) {
        for (const id of answerOptionIds(field, r.answers[field.id])) {
          if (counts.has(id)) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
            total += 1;
          }
        }
      }
      if (total === 0) continue;
      out.push({ field, options, counts });
    }
    return out;
  }, [fields, responses]);

  const searchTexts = useMemo(
    () =>
      new Map(
        responses.map((r) => [r.id, responseSearchText(r, fields, sourcedLabels)]),
      ),
    [responses, fields, sourcedLabels],
  );

  const shownResponses = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = responses.filter((r) => {
      if (q && !(searchTexts.get(r.id) ?? "").includes(q)) return false;
      for (const cf of chipFields) {
        const picked = chipFilters[cf.field.id];
        if (
          picked &&
          !answerOptionIds(cf.field, r.answers[cf.field.id]).includes(picked)
        ) {
          return false;
        }
      }
      return true;
    });
    rows.sort((a, b) =>
      sortDir === "newest"
        ? Date.parse(b.created_at) - Date.parse(a.created_at)
        : Date.parse(a.created_at) - Date.parse(b.created_at),
    );
    return rows;
  }, [responses, search, searchTexts, chipFields, chipFilters, sortDir]);

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

  if (responses.length === 0) {
    return (
      <div className="rounded-md p-12 text-center">
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
  const filtering =
    search.trim() !== "" || chipFields.some((cf) => chipFilters[cf.field.id]);
  const colSpan = visible.length + 2 + (hasMore ? 1 : 0);

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
        {filtering ? (
          <span className="text-xs text-muted-foreground">
            {shownResponses.length} shown
          </span>
        ) : null}
        {latest ? (
          <span className="text-xs text-muted-foreground">
            Latest {formatDate(latest)}
          </span>
        ) : null}
      </div>

      <SummaryStrip fields={fields} responses={responses} />

      {/* Filter toolbar — search across answers + respondent, and option
          chips for the leading choice fields. All client-side. */}
      <div className="flex flex-col gap-2">
        <div className="relative w-64 max-w-full">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search responses…"
            aria-label="Search responses"
            className="h-8 pl-7"
          />
        </div>
        {chipFields.map(({ field, options, counts }) => {
          const active = chipFilters[field.id] ?? null;
          return (
            <div key={field.id} className="flex flex-wrap items-center gap-1.5">
              <span className="max-w-40 truncate text-xs font-medium text-faint-foreground">
                {field.label}
              </span>
              <Chip
                size="sm"
                selected={active === null}
                onClick={() =>
                  setChipFilters((prev) => ({ ...prev, [field.id]: null }))
                }
              >
                All
                <span className="tabular-nums opacity-70">{responses.length}</span>
              </Chip>
              {options.map((opt) => {
                const count = counts.get(opt.id) ?? 0;
                // Zero-count chips stay (disabled) so the row doesn't reflow
                // as answers arrive — the bookings agenda pattern.
                const empty = count === 0;
                return (
                  <Chip
                    key={opt.id}
                    size="sm"
                    selected={active === opt.id}
                    disabled={empty}
                    onClick={() =>
                      setChipFilters((prev) => ({
                        ...prev,
                        [field.id]: active === opt.id ? null : opt.id,
                      }))
                    }
                    className={cn(empty && "opacity-40")}
                  >
                    {opt.label}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </Chip>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Notion database table (notion-spec-v2 §6): 36px header of 14px w400
          tertiary labels, 37px rows, BOTH dividers, no zebra, no outer
          frame — a data view breaks out of the document column. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-9 border-b border-border text-left font-normal text-muted-foreground">
              {hasMore ? (
                <th className="w-8 border-r border-border px-2 font-normal" />
              ) : null}
              <th className="border-r border-border px-2 font-normal">
                Respondent
              </th>
              {visible.map((f) => (
                <th
                  key={f.id}
                  className="max-w-44 truncate border-r border-border px-2 font-normal"
                >
                  {f.label}
                </th>
              ))}
              <th className="px-2 font-normal">
                <button
                  type="button"
                  onClick={() =>
                    setSortDir((d) => (d === "newest" ? "oldest" : "newest"))
                  }
                  aria-label={`Sort by submitted date, ${
                    sortDir === "newest" ? "newest" : "oldest"
                  } first`}
                  className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 hover:bg-accent"
                >
                  Submitted
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      sortDir === "oldest" && "rotate-180",
                    )}
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shownResponses.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="py-8 text-center text-muted-foreground"
                >
                  No responses match your filters.
                </td>
              </tr>
            ) : (
              shownResponses.map((r) => (
                <ResponseRows
                  key={r.id}
                  response={r}
                  visible={visible}
                  allFields={fields}
                  hasMore={hasMore}
                  expanded={expanded.has(r.id)}
                  onToggle={() => toggle(r.id)}
                  sourcedLabels={sourcedLabels}
                />
              ))
            )}
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
  sourcedLabels,
}: {
  response: ResponseRow;
  visible: FormField[];
  allFields: FormField[];
  hasMore: boolean;
  expanded: boolean;
  onToggle: () => void;
  sourcedLabels: Record<string, Record<string, string>>;
}) {
  const colSpan = visible.length + 2 + (hasMore ? 1 : 0);
  return (
    <>
      <tr className="h-[37px] border-b border-border last:border-0">
        {hasMore ? (
          <td className="border-r border-border px-2">
            <button
              type="button"
              onClick={onToggle}
              aria-label={expanded ? "Collapse row" : "Expand row"}
              className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
          </td>
        ) : null}
        {/* The name cell is the UI-row rung: 14px w500 primary. */}
        <td className="border-r border-border px-2 font-medium whitespace-nowrap">
          {response.respondent?.name ?? "Anonymous"}
        </td>
        {visible.map((f) => (
          <td
            key={f.id}
            className="max-w-44 truncate border-r border-border px-2"
          >
            <AnswerCell
              field={f}
              value={response.answers[f.id]}
              labels={sourcedLabels[f.id]}
            />
          </td>
        ))}
        <td className="px-2 whitespace-nowrap text-muted-foreground">
          {formatDate(response.created_at)}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border bg-muted last:border-0">
          <td colSpan={colSpan} className="px-2 py-3">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {allFields.map((f) => (
                <div key={f.id}>
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="text-sm">
                    <AnswerCell
                      field={f}
                      value={response.answers[f.id]}
                      labels={sourcedLabels[f.id]}
                    />
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
 * uploaded objects (the bucket is public), signatures render the drawn
 * image, sourced choice / people answers map through the resolved labels;
 * everything else goes through formatAnswer().
 */
function AnswerCell({
  field,
  value,
  labels,
}: {
  field: FormField;
  value: FormAnswerValue | undefined;
  labels?: Record<string, string>;
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
  if (
    field.type === "signature" &&
    typeof value === "string" &&
    value.startsWith("data:image/")
  ) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={value} alt="Signature" className="h-8 w-auto max-w-32 object-contain" />
    );
  }
  if (labels) {
    if (typeof value === "string" && value) {
      return <>{labels[value] ?? value}</>;
    }
    if (Array.isArray(value)) {
      const names = value
        .filter((v): v is string => typeof v === "string")
        .map((v) => labels[v] ?? v);
      if (names.length > 0) return <>{names.join(", ")}</>;
    }
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
          className="w-56 shrink-0 rounded-card p-3 shadow-ring"
        >
          {/* A per-field summary tile is a WELL, not a page: bare warm ring,
              no card shadow, and its heading is a 12px section label. */}
          <p className="truncate text-xs font-medium text-faint-foreground">
            {s.field.label}
          </p>
          {s.kind === "rating" ? (
            <p className="mt-2 text-2xl font-semibold">
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
                        // Answer-distribution meter — a VALUE, so warm ink
                        // (same call as `ui/progress`), never `--primary`.
                        className="h-full rounded-full bg-secondary-ink"
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

/* ------------------------------ Preview tab ------------------------------ */

/**
 * ClickUp's Preview tab: the real fill experience (interactive, background
 * applied), fed by the WORKING schema so unsaved edits preview instantly.
 * Submissions are simulated — nothing is stored.
 */
function PreviewTab({
  title,
  description,
  icon,
  schema,
  propertyId,
}: {
  title: string;
  description: string | null;
  icon: string | null;
  schema: FormSchema;
  propertyId: string;
}) {
  const background = schema.settings?.background ?? "default";
  return (
    <div
      className={cn(
        "rounded-lg px-6 py-10 sm:px-10 sm:py-14",
        FORM_BACKGROUND_CLASSES[background],
      )}
    >
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex flex-col items-start gap-4">
          {icon ? (
            <div className="flex size-14 items-center justify-center rounded-md bg-background text-3xl shadow-ring">
              {icon}
            </div>
          ) : null}
          <div>
            <h2 className="text-2xl font-semibold text-balance">{title}</h2>
            {description ? (
              <p className="mt-2 max-w-prose text-base leading-relaxed text-foreground/80">
                {description}
              </p>
            ) : null}
          </div>
        </header>
        <div className="mt-8">
          {schema.fields.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Add questions in the Build tab to preview the form.
            </p>
          ) : (
            <FormRenderer
              schema={schema}
              onSubmit={async () => {
                toast.success("Preview only — nothing was submitted");
                return { ok: true };
              }}
              mode="page"
              propertyId={propertyId}
            />
          )}
        </div>
      </div>
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
  shared,
  onPatchSettings,
}: {
  propertyId: string;
  form: FormRow;
  status: FormStatus;
  savingStatus: boolean;
  onStatusChange: (status: FormStatus) => void;
  shared: BuilderShared;
  onPatchSettings: (patch: Partial<FormSettings>) => void;
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

  const settings = shared.schema.settings ?? {};

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

      {/* Submission settings — ClickUp's right rail. These live in the schema
          JSON, so they save with the same working copy as the Build tab. */}
      <section className="space-y-4">
        <div>
          <p className="text-sm font-medium">Submission settings</p>
          <p className="text-xs text-muted-foreground">
            What respondents see while filling and after submitting.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="settings-submit-label">Button label</Label>
            <Input
              id="settings-submit-label"
              value={settings.submitLabel ?? ""}
              maxLength={40}
              placeholder="Submit"
              onChange={(e) =>
                onPatchSettings({ submitLabel: e.target.value || undefined })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-redirect">Redirect URL</Label>
            <Input
              id="settings-redirect"
              value={settings.redirectUrl ?? ""}
              placeholder="https://"
              onChange={(e) =>
                onPatchSettings({ redirectUrl: e.target.value || undefined })
              }
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settings-confirmation">Confirmation message</Label>
          <Textarea
            id="settings-confirmation"
            value={settings.confirmationMessage ?? ""}
            placeholder="Thanks — your answers have been submitted."
            rows={2}
            maxLength={500}
            onChange={(e) =>
              onPatchSettings({ confirmationMessage: e.target.value || undefined })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label>Layout</Label>
          <div className="flex gap-2">
            {(
              [
                { value: "one", label: "One column" },
                { value: "two", label: "Two column" },
              ] as const
            ).map((opt) => {
              const active = (settings.layout ?? "one") === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    onPatchSettings({
                      layout: opt.value === "one" ? undefined : opt.value,
                    })
                  }
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-accent",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Background</Label>
          <div className="flex flex-wrap gap-2">
            {FORM_BACKGROUNDS.map((bg) => {
              const active = (settings.background ?? "default") === bg;
              return (
                <button
                  key={bg}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Background ${FORM_BACKGROUND_LABELS[bg]}`}
                  title={FORM_BACKGROUND_LABELS[bg]}
                  onClick={() =>
                    onPatchSettings({
                      background: bg === "default" ? undefined : bg,
                    })
                  }
                  className={cn(
                    "size-8 rounded-md shadow-ring transition-transform",
                    FORM_BACKGROUND_CLASSES[bg],
                    active && "scale-110 shadow-focus",
                  )}
                />
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={shared.save} disabled={!shared.dirty || shared.saving}>
            {shared.saving ? "Saving…" : shared.dirty ? "Save" : "Saved"}
          </Button>
          {shared.dirty ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Eye className="size-3.5" />
              Check the Preview tab before saving
            </span>
          ) : null}
        </div>
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

      <TaskAutomationCard propertyId={propertyId} formId={form.id} />

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
