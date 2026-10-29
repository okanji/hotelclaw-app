"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  Copy,
  Eye,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import type { TintTone } from "@/components/ui/tint-card";
import { Gi } from "@/components/gr8r/icon";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TASK_PROPERTY_META, type FormField, type FormSchema } from "@/lib/forms/schema";
import { FormFieldInput, FormRenderer } from "./form-renderer";
import { AiEditPopover, type BuilderShared, type FieldPreset } from "./form-builder-extras";
import { FieldPanel } from "./form-field-panel";
import { FORM_BACKGROUND_CLASSES } from "./backgrounds";
import {
  FIELD_KIND,
  PALETTE,
  paletteKind,
  paletteTone,
  type PaletteKind,
} from "./field-kinds";

/** Palette group tone → the gr8r hue fed to `.ftype` as `--g8-c`. */
const TONE_VAR: Record<TintTone, string> = {
  lavender: "var(--g8-violet)",
  blue: "var(--g8-blue)",
  sage: "var(--g8-green)",
  coral: "var(--g8-red)",
  honey: "var(--g8-amber)",
};

/**
 * The form builder — a port of the studio platform's TemplateBuilder onto
 * our schema. The form is a column of field cards, each showing the
 * question exactly as respondents will see it (the real `FormFieldInput`,
 * inert) with its own grip, "add below" menu, duplicate and remove. The
 * side card holds two tabs — "Add a field" (tinted tiles, grouped; click to
 * append or DRAG a tile into the form at a precise spot) and "Form
 * settings" — and swaps to the selected field's details when one is open
 * (a bottom sheet when the builder is narrow). Every change autosaves; the
 * page owns the working schema and the save loop.
 */

const END = "__end";
/** The side card sits beside the form at this builder width (container,
 *  not viewport — the shell's sidebar eats a variable share of the page). */
const WIDE_PX = 860;

function useWide(ref: React.RefObject<HTMLElement | null>) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWide(entry.contentRect.width >= WIDE_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return wide;
}

export function FormBuilder({
  shared,
  title,
  meta,
  settings,
}: {
  shared: BuilderShared;
  /** The rename-in-place title + description block. */
  title: ReactNode;
  /** Title / description / icon as they stand now, for the preview. */
  meta: { title: string; description: string | null; icon: string | null };
  /** The "Form settings" tab body. */
  settings: ReactNode;
}) {
  const { schema, selectedId, setSelectedId, propertyId } = shared;
  const fields = schema.fields;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wide = useWide(rootRef);
  const [tab, setTab] = useState<"add" | "settings">("add");

  // Two kinds of drag share one context: reordering a field card, and
  // dragging a new field type in from the side card.
  const [dragNew, setDragNew] = useState<string | null>(null);
  const [dragCard, setDragCard] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const collision: CollisionDetection = (args) => {
    if (!dragNew) return closestCenter(args);
    // A new field only lands when the pointer is over the form column;
    // letting go anywhere else does nothing.
    const r = listRef.current?.getBoundingClientRect();
    const p = args.pointerCoordinates;
    if (!r || !p || p.x < r.left || p.x > r.right || p.y < r.top - 24 || p.y > r.bottom + 24) {
      return [];
    }
    return closestCenter(args);
  };

  function onDragStart({ active }: DragStartEvent) {
    const key = active.data.current?.newKey as string | undefined;
    if (key) {
      setDragNew(key);
      return;
    }
    setDragCard(String(active.id));
  }

  function onDragMove({ active, over }: DragMoveEvent) {
    if (!dragNew) return;
    if (!over) {
      setDrop(null);
      return;
    }
    if (over.id === END) {
      setDrop({ id: END, after: true });
      return;
    }
    const a = active.rect.current.translated;
    setDrop({
      id: String(over.id),
      after: a ? a.top + a.height / 2 > over.rect.top + over.rect.height / 2 : false,
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const key = dragNew;
    const d = drop;
    setDragNew(null);
    setDragCard(null);
    setDrop(null);
    if (key) {
      const kind = paletteKind(key);
      if (!over || !d || !kind) return;
      const at =
        d.id === END
          ? fields.length
          : fields.findIndex((f) => f.id === d.id) + (d.after ? 1 : 0);
      shared.insertField(at, kind.preset);
      return;
    }
    if (!over || active.id === over.id || over.id === END) return;
    shared.reorder(String(active.id), String(over.id));
  }

  function resetDrag() {
    setDragNew(null);
    setDragCard(null);
    setDrop(null);
  }

  // Bring the opened field into view (a field added from the palette
  // appears at the end, possibly off-screen).
  useEffect(() => {
    if (!selectedId) return;
    document
      .getElementById(`form-field-${selectedId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const openIndex = selectedId ? fields.findIndex((f) => f.id === selectedId) : -1;
  const current = openIndex >= 0 ? fields[openIndex] : null;
  const panel = current ? (
    <FieldPanel
      key={current.id}
      field={current}
      index={openIndex}
      schema={schema}
      propertyId={propertyId}
      onPatch={(patch) => shared.patchField(current.id, patch)}
      onClose={() => {
        setSelectedId(null);
        setTab("add");
      }}
    />
  ) : null;
  const draggedCard = dragCard ? fields.find((f) => f.id === dragCard) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      modifiers={dragNew ? [] : [restrictToVerticalAxis]}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={resetDrag}
    >
      <div ref={rootRef}>
        <div
          className={cn(
            "grid items-start gap-8",
            wide && "grid-cols-[minmax(0,1fr)_20rem] gap-10",
          )}
        >
          <div className="grid min-w-0 gap-6">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">{title}</div>
              {/* Sits on the title's centre line. */}
              <div className="flex h-10 shrink-0 items-center gap-2">
                <AiEditPopover shared={shared} />
                <PreviewButton schema={schema} meta={meta} propertyId={propertyId} />
              </div>
            </div>

            <div ref={listRef} className="grid gap-3">
              <SortableContext
                items={fields.map((f) => f.id)}
                strategy={verticalListSortingStrategy}
              >
                <ol className="grid gap-3">
                  {fields.map((field, i) => (
                    <FieldCard
                      key={field.id}
                      field={field}
                      propertyId={propertyId}
                      selected={selectedId === field.id}
                      line={
                        drop?.id === field.id ? (drop.after ? "after" : "before") : undefined
                      }
                      onToggle={() =>
                        setSelectedId(selectedId === field.id ? null : field.id)
                      }
                      onAddBelow={(preset) => shared.insertField(i + 1, preset)}
                      onDuplicate={() => shared.duplicateField(field.id)}
                      onRemove={() => shared.removeField(field.id)}
                    />
                  ))}
                </ol>
              </SortableContext>
              <EndZone
                empty={fields.length === 0}
                active={Boolean(dragNew)}
                over={drop?.id === END}
              />
            </div>
          </div>

          <aside
            className={cn(
              "panel g8-fb-side grid gap-5 p-4",
              wide ? "sticky top-4 max-h-[calc(100dvh-7rem)] overflow-y-auto" : "order-first",
            )}
          >
            {wide && panel ? panel : null}
            <div hidden={Boolean(wide && panel)} className="grid gap-5">
              {/* gr8r `.seg` switch between the palette and form settings. */}
              <div className="seg g8-fb-seg" role="tablist" aria-label="Builder panel">
                {(
                  [
                    ["add", "Add a field"],
                    ["settings", "Form settings"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    className={tab === k ? "on" : ""}
                    onClick={() => setTab(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div role="tabpanel" aria-label="Add a field" hidden={tab !== "add"} className="grid gap-4">
                <p className="hint" style={{ margin: 0 }}>
                  Drag a type into the form, or click it to add it at the end.
                </p>
                {PALETTE.map((group) => (
                  <div key={group.label} className="grid gap-2">
                    <div className="eyebrow">{group.label}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {group.kinds.map((k) => (
                        <PaletteTile
                          key={k.key}
                          kind={k}
                          tone={group.tone}
                          onAdd={() => shared.insertField(fields.length, k.preset)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Kept mounted while hidden so its panels keep their state. */}
              <div
                role="tabpanel"
                aria-label="Form settings"
                hidden={tab !== "settings"}
                className="grid gap-6"
              >
                {settings}
              </div>
            </div>
          </aside>
        </div>

        {!wide ? (
          <Sheet
            open={Boolean(panel)}
            onOpenChange={(open) => {
              if (!open) setSelectedId(null);
            }}
          >
            <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto p-5">
              <SheetTitle className="sr-only">Edit field</SheetTitle>
              {panel}
            </SheetContent>
          </Sheet>
        ) : null}
      </div>

      <PortalDragOverlay dropAnimation={null}>
        {dragNew ? (
          (() => {
            const kind = paletteKind(dragNew);
            // The overlay portals to <body>, outside the shell's `.g8` scope —
            // re-enter it so the gr8r tile classes resolve.
            return kind ? (
              <div className="g8 g8-overlay-scope">
                <TileFace kind={kind} tone={paletteTone(dragNew)} lifted />
              </div>
            ) : null;
          })()
        ) : draggedCard ? (
          <div className="g8 g8-overlay-scope">
            <div className="g8-fcard lifted" style={{ padding: "12px 16px" }}>
              <FieldPreview field={draggedCard} propertyId={propertyId} />
            </div>
          </div>
        ) : null}
      </PortalDragOverlay>
    </DndContext>
  );
}

/* ------------------------------ Palette --------------------------------- */

/** A field type in the side card: click to add it at the end, or drag it
 *  to a spot in the form. Pointer drags only — Enter / Space keep meaning
 *  "add", so keyboard users get a plain button. */
function PaletteTile({
  kind,
  tone,
  onAdd,
}: {
  kind: PaletteKind;
  tone: TintTone;
  onAdd: () => void;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `new:${kind.key}`,
    data: { newKey: kind.key },
  });
  const pointerListeners = {
    onMouseDown: listeners?.onMouseDown as React.MouseEventHandler<HTMLButtonElement> | undefined,
    onTouchStart: listeners?.onTouchStart as React.TouchEventHandler<HTMLButtonElement> | undefined,
  };
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onAdd}
      {...pointerListeners}
      aria-label={`Add ${kind.label}`}
      className={cn(
        "group relative touch-manipulation rounded-md text-left focus-visible:shadow-focus focus-visible:outline-none",
        isDragging && "opacity-40",
      )}
    >
      <TileFace kind={kind} tone={tone} />
    </button>
  );
}

function TileFace({
  kind,
  tone,
  lifted,
}: {
  kind: PaletteKind;
  tone: TintTone;
  lifted?: boolean;
}) {
  return (
    <span className={cn("g8-fb-tile", lifted && "lifted")}>
      <span className="ftype" style={{ "--g8-c": TONE_VAR[tone], width: 24, height: 24 } as React.CSSProperties}>
        <Gi icon={kind.icon} size={13} />
      </span>
      {kind.label}
      <Gi icon={Plus} size={13} className="g8-fb-tile-plus" />
    </span>
  );
}

/** The drop target after the last field; also the empty state. */
function EndZone({ empty, active, over }: { empty: boolean; active: boolean; over: boolean }) {
  const { setNodeRef } = useDroppable({ id: END });
  if (!empty && !active) return <div ref={setNodeRef} className="h-2" />;
  return (
    <div
      ref={setNodeRef}
      className={cn("dropzone g8-fb-end", empty ? "py-10" : "py-5", over && "over")}
    >
      {active
        ? "Drop here to add it at the end"
        : "No fields yet. Drag a field type here, or click one to add it."}
    </div>
  );
}

/* ------------------------------ Field cards ------------------------------ */

/** A field card that drags by its grip. The grip is a real button, so
 *  Space picks it up and the arrow keys move it. */
function FieldCard({
  field,
  propertyId,
  selected,
  line,
  onToggle,
  onAddBelow,
  onDuplicate,
  onRemove,
}: {
  field: FormField;
  propertyId: string;
  selected: boolean;
  line?: "before" | "after";
  onToggle: () => void;
  onAddBelow: (preset: FieldPreset) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });
  const kind = FIELD_KIND[field.type];
  const notes = [
    kind.label,
    field.required ? "required" : null,
    field.taskProperty
      ? `sets the task’s ${TASK_PROPERTY_META[field.taskProperty].label.toLowerCase()}`
      : null,
    field.source ? "options from app data" : null,
    field.condition ? "only asked sometimes" : null,
  ].filter(Boolean);

  return (
    <li
      ref={setNodeRef}
      id={`form-field-${field.id}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-current={selected || undefined}
      className={cn(
        "g8-fcard relative scroll-mt-24",
        selected && "on",
        // The overlay carries the visible copy; the slot marks the drop spot.
        isDragging && "opacity-40",
      )}
    >
      {line ? (
        <span
          aria-hidden
          className={cn(
            "g8-fb-line pointer-events-none absolute inset-x-2 h-0.5",
            line === "before" ? "-top-[7px]" : "-bottom-[7px]",
          )}
        />
      ) : null}
      <div className="flex items-center gap-1 pt-2 pr-3 pl-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                aria-label={`Reorder ${field.label || kind.label}`}
                className="ibtn ibtn-sm touch-none"
                style={{ cursor: "grab" }}
              />
            }
          >
            <Gi icon={GripVertical} size={14} />
          </TooltipTrigger>
          <TooltipContent>Drag to reorder</TooltipContent>
        </Tooltip>
        <span className="row faint" style={{ minWidth: 0, gap: 6, fontSize: "var(--g8-fs-xs)" }}>
          <Gi icon={kind.icon} size={13} />
          <span className="truncate">{notes.join(" · ")}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center">
          <AddBelow onPick={onAddBelow} />
          <IconAction label="Duplicate" onClick={onDuplicate}>
            <Gi icon={Copy} size={14} />
          </IconAction>
          <IconAction label="Remove" onClick={onRemove}>
            <Gi icon={Trash2} size={14} />
          </IconAction>
        </span>
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="block w-full cursor-pointer rounded-b-card px-4 pt-2 pb-4 text-left focus-visible:shadow-focus focus-visible:outline-none"
      >
        <span className="sr-only">Edit {field.label || kind.label}. </span>
        <FieldPreview field={field} propertyId={propertyId} />
      </div>
    </li>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" className="ibtn ibtn-sm" onClick={onClick} aria-label={label} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function AddBelow({ onPick }: { onPick: (preset: FieldPreset) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Add a field below"
            title="Add a field below"
          />
        }
      >
        <Gi icon={Plus} size={13} />
        <Gi icon={ChevronDown} size={11} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-56 overflow-y-auto">
        {PALETTE.map((group, gi) => (
          <DropdownMenuGroup key={group.label}>
            {gi ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {group.label}
            </DropdownMenuLabel>
            {group.kinds.map((k) => (
              <DropdownMenuItem key={k.key} onClick={() => onPick(k.preset)}>
                <k.icon data-slot="icon" />
                {k.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The question as respondents see it — the real `FormFieldInput`, inert
 * (`pointer-events-none`), so a click anywhere selects the card instead of
 * focusing the control.
 */
function FieldPreview({ field, propertyId }: { field: FormField; propertyId: string }) {
  if (field.type === "section") {
    return (
      <span className="block">
        <span className="block text-lg font-semibold text-balance">
          {field.label || "Section heading"}
        </span>
        {field.description ? (
          <span className="mt-1 block text-sm text-muted-foreground">{field.description}</span>
        ) : null}
      </span>
    );
  }
  if (field.type === "info") {
    return (
      <span className="block">
        <span className="block text-sm whitespace-pre-line text-pretty">
          {field.label || "Paragraph of text. Open to write it."}
        </span>
        {field.description ? (
          <span className="mt-1 block text-sm whitespace-pre-line text-muted-foreground">
            {field.description}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "block space-y-2",
        field.type === "consent" && "rounded-card p-4 shadow-ring",
      )}
    >
      <span className="flex items-baseline gap-0.5 text-sm font-semibold">
        {field.label || <span className="text-muted-foreground">Untitled question</span>}
        {field.required ? (
          <span aria-hidden className="text-destructive">
            *
          </span>
        ) : null}
      </span>
      {field.description ? (
        <span className="block text-sm whitespace-pre-line text-muted-foreground">
          {field.description}
        </span>
      ) : field.type === "consent" ? (
        <span className="block text-sm text-muted-foreground">
          The statement the respondent agrees to. Open to write it.
        </span>
      ) : null}
      <span className="pointer-events-none block" aria-hidden>
        <FormFieldInput
          field={field}
          value={undefined}
          onChange={() => {}}
          disabled
          propertyId={propertyId}
        />
      </span>
    </span>
  );
}

/* -------------------------------- Preview -------------------------------- */

/**
 * Opens the form as respondents will see it, built from the WORKING schema
 * (unsaved edits included), in either fill mode. Submitting does nothing.
 */
function PreviewButton({
  schema,
  meta,
  propertyId,
}: {
  schema: FormSchema;
  meta: { title: string; description: string | null; icon: string | null };
  propertyId: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"page" | "wizard">("page");
  const background = schema.settings?.background ?? "default";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <Gi icon={Eye} size={13} />
        Preview
      </button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="sr-only">Preview of {meta.title || "this form"}</DialogTitle>
        <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
          <p className="text-xs text-muted-foreground">
            Preview — how respondents see the form. Nothing you enter is saved.
          </p>
          <div className="flex gap-1">
            <Chip size="sm" selected={mode === "page"} onClick={() => setMode("page")}>
              One page
            </Chip>
            <Chip size="sm" selected={mode === "wizard"} onClick={() => setMode("wizard")}>
              One question at a time
            </Chip>
          </div>
        </div>
        <div className={cn("rounded-card px-5 py-8 sm:px-8", FORM_BACKGROUND_CLASSES[background])}>
          <header className="mb-6 flex flex-col items-start gap-3">
            {meta.icon ? (
              <span className="flex size-12 items-center justify-center rounded-md bg-background text-2xl shadow-ring">
                {meta.icon}
              </span>
            ) : null}
            <h2 className="text-2xl font-semibold text-balance">{meta.title || "Untitled form"}</h2>
            {meta.description ? (
              <p className="max-w-prose text-base text-pretty text-muted-foreground">
                {meta.description}
              </p>
            ) : null}
          </header>
          {schema.fields.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Add a field to preview the form.
            </p>
          ) : (
            <FormRenderer
              // Keyed so each open / mode switch starts blank.
              key={`${String(open)}-${mode}`}
              schema={schema}
              mode={mode}
              propertyId={propertyId}
              onSubmit={async () => {
                toast.success("Preview only — nothing was sent");
                return { ok: true };
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
