"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Plus, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";
import {
  FIELD_TYPE_LABEL,
  isChoiceField,
  newOption,
  optionColor,
} from "@/lib/tasks/custom-field-options";
import { OptionChip } from "./custom-field-chip";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import {
  customFieldsQueryOptions,
  type CustomFieldRow,
} from "@/lib/query/custom-field-queries";
import { updateCustomField } from "./field-actions";
import type { CustomFieldOption } from "@/lib/db/types";

/**
 * Workspace-level Custom Field Manager (the ClickUp lesson: without one,
 * duplicate fields multiply and nobody can clean up). Lists every active
 * definition with scope + usage count; rename inline, edit dropdown options,
 * archive. Creation happens where the need arises — the task sidebar's
 * "Add field" popover.
 */
export function CustomFieldManager({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="size-3.5" />
        Fields
      </Button>
      {open ? (
        <ManagerDialog
          propertyId={propertyId}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}

function ManagerDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: fields = [] } = useQuery(customFieldsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));

  // Usage counts — head-only count per field (definitions are few). Keyed by
  // the id SET, not the count: archiving one field and creating another kept
  // the same length and served stale numbers.
  const { data: usage = {} } = useQuery({
    queryKey: [
      "custom-field-usage",
      propertyId,
      fields.map((f) => f.id).join(","),
    ] as const,
    enabled: fields.length > 0,
    queryFn: async (): Promise<Record<string, number>> => {
      const supabase = createClient();
      const counts = await Promise.all(
        fields.map(async (f) => {
          const { count } = await supabase
            .from("task_field_values")
            .select("task_id", { count: "exact", head: true })
            .eq("field_id", f.id);
          return [f.id, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(counts);
    },
  });

  // Archived definitions, for restore — the main query deliberately filters
  // these out everywhere else in the app.
  const { data: archived = [] } = useQuery({
    queryKey: ["custom-fields-archived", propertyId] as const,
    queryFn: async (): Promise<CustomFieldRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("custom_fields")
        .select("id, space_id, name, type, options, position")
        .eq("property_id", propertyId)
        .not("archived_at", "is", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as CustomFieldRow[];
    },
  });

  const spaceName = (id: string | null) =>
    id ? (spaces.find((s) => s.id === id)?.name ?? "One team") : "All tasks";

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ["custom-fields", propertyId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["custom-fields-archived", propertyId],
    });
  }

  function restore(field: CustomFieldRow) {
    void updateCustomField({ fieldId: field.id, archived: false }).then(
      (res) => {
        if ("error" in res) toast.error(res.error);
        else {
          toast.success(`"${field.name}" restored`);
          refresh();
        }
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Custom fields</DialogTitle>
          <DialogDescription>
            Every field in this workspace — rename, edit options, or archive.
            Create new fields from any task&rsquo;s Fields section.
          </DialogDescription>
        </DialogHeader>
        {fields.length === 0 && archived.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            No custom fields yet — add one from a task&rsquo;s sidebar.
          </p>
        ) : (
          <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            <ul className="flex flex-col gap-1">
              {fields.map((f) => (
                <FieldManagerRow
                  key={f.id}
                  field={f}
                  scopeLabel={spaceName(f.space_id)}
                  usageCount={usage[f.id] ?? 0}
                  onChanged={refresh}
                />
              ))}
            </ul>
            {archived.length > 0 ? (
              <div className="mt-2">
                <p className="px-1.5 pb-1 text-xs font-medium text-faint-foreground">
                  Archived
                </p>
                <ul className="flex flex-col gap-1">
                  {archived.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {f.name}
                      </span>
                      <span className="shrink-0 text-xs text-faint-foreground">
                        {FIELD_TYPE_LABEL[f.type]}
                      </span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title="Restore field"
                        aria-label={`Restore ${f.name}`}
                        onClick={() => restore(f)}
                        className="size-6 text-muted-foreground"
                      >
                        <ArchiveRestore className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldManagerRow({
  field,
  scopeLabel,
  usageCount,
  onChanged,
}: {
  field: CustomFieldRow;
  scopeLabel: string;
  usageCount: number;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(field.name);
  const [editingOptions, setEditingOptions] = useState(false);

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === field.name) {
      setName(field.name);
      return;
    }
    startTransition(async () => {
      const res = await updateCustomField({ fieldId: field.id, name: trimmed });
      if ("error" in res) {
        toast.error(res.error);
        setName(field.name);
      } else onChanged();
    });
  }

  function commitOptions(next: CustomFieldOption[]) {
    startTransition(async () => {
      const res = await updateCustomField({ fieldId: field.id, options: next });
      if ("error" in res) toast.error(res.error);
      else onChanged();
    });
  }

  function archive() {
    startTransition(async () => {
      const res = await updateCustomField({ fieldId: field.id, archived: true });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(`"${field.name}" archived`);
        onChanged();
      }
    });
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-md bg-muted px-3 py-2">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          disabled={pending}
          className="h-7 flex-1 border-transparent px-1.5 text-sm font-medium shadow-none focus-visible:border-border"
        />
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-faint-foreground">
          {FIELD_TYPE_LABEL[field.type]}
        </span>
        <span className="shrink-0 text-xs text-faint-foreground">
          {scopeLabel}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {usageCount} {usageCount === 1 ? "task" : "tasks"}
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="Archive field"
          aria-label={`Archive ${field.name}`}
          disabled={pending}
          onClick={archive}
          className="size-6 text-muted-foreground"
        >
          <Archive className="size-3.5" />
        </Button>
      </div>
      {isChoiceField(field.type) ? (
        editingOptions ? (
          <OptionListEditor
            field={field}
            pending={pending}
            onCommit={commitOptions}
            onClose={() => setEditingOptions(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingOptions(true)}
            aria-label={`Edit options for ${field.name}`}
            className="flex w-fit flex-wrap items-center gap-1 rounded-md text-left"
          >
            {field.options.length === 0 ? (
              <span className="text-xs text-muted-foreground">No options</span>
            ) : (
              field.options.map((o) => <OptionChip key={o.id} option={o} />)
            )}
          </button>
        )
      ) : null}
    </li>
  );
}

/**
 * Structured, ID-STABLE option editing. The old textarea round-tripped
 * options through `parseOptionsInput`, which matches by LABEL — so renaming
 * "Quoted" to "Quoting" minted a fresh id and orphaned every task value
 * pointing at the old one, despite the schema's "renaming never breaks
 * stored data" contract. Here each row edits the option in place: the id
 * never changes, only the label/colour do, exactly like ClickUp's option
 * editor. Deleting a row is the only operation that can orphan values, and
 * it says so.
 */
function OptionListEditor({
  field,
  pending,
  onCommit,
  onClose,
}: {
  field: CustomFieldRow;
  pending: boolean;
  onCommit: (next: CustomFieldOption[]) => void;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<CustomFieldOption[]>(field.options);
  const [adding, setAdding] = useState("");

  function apply(next: CustomFieldOption[]) {
    setOpts(next);
    onCommit(next);
  }

  function rename(id: string, label: string) {
    const trimmed = label.trim();
    const current = opts.find((o) => o.id === id);
    if (!current || !trimmed || trimmed === current.label) return;
    apply(opts.map((o) => (o.id === id ? { ...o, label: trimmed } : o)));
  }

  function recolor(id: string, color: CustomFieldOption["color"]) {
    apply(opts.map((o) => (o.id === id ? { ...o, color } : o)));
  }

  function remove(option: CustomFieldOption) {
    if (opts.length <= 1) {
      toast.error("A choice field needs at least one option");
      return;
    }
    const prev = opts;
    apply(opts.filter((o) => o.id !== option.id));
    toast(`Removed "${option.label}"`, {
      description: "Tasks that had it selected now show nothing for it.",
      action: { label: "Undo", onClick: () => apply(prev) },
    });
  }

  function add() {
    // Paste-a-column still works: each non-empty line becomes one option.
    const labels = adding
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (labels.length === 0) return;
    let next = opts;
    for (const label of labels) {
      if (next.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
        continue;
      }
      next = [...next, newOption(label, next)];
    }
    setAdding("");
    if (next !== opts) apply(next);
  }

  return (
    <div className="flex flex-col gap-1 rounded-md bg-background p-1.5">
      {opts.map((o) => (
        <div key={o.id} className="flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  title="Color"
                  aria-label={`Color for ${o.label}`}
                  disabled={pending}
                  className="grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-accent"
                />
              }
            >
              <span
                className={cn("size-2.5 rounded-full", LABEL_DOT[optionColor(o)])}
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-1.5">
              <div className="flex items-center gap-1">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => recolor(o.id, c)}
                    className={cn(
                      "grid size-6 place-items-center rounded-md transition-colors hover:bg-accent",
                      optionColor(o) === c && "bg-accent-pressed",
                    )}
                  >
                    <span className={cn("size-2.5 rounded-full", LABEL_DOT[c])} />
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Input
            // Remount on a committed rename — an uncontrolled input whose
            // defaultValue changes in place trips base-ui's FieldControl
            // warning and would keep showing the stale draft.
            key={`${o.id}:${o.label}`}
            defaultValue={o.label}
            disabled={pending}
            onBlur={(e) => rename(o.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-7 flex-1 border-transparent px-1.5 text-sm shadow-none focus-visible:border-border"
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title="Remove option"
            aria-label={`Remove ${o.label}`}
            disabled={pending}
            onClick={() => remove(o)}
            className="size-6 text-muted-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">
          <Plus className="size-3.5" />
        </span>
        <Input
          value={adding}
          disabled={pending}
          placeholder="Add an option…"
          onChange={(e) => setAdding(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-7 flex-1 border-transparent px-1.5 text-sm shadow-none focus-visible:border-border"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-6 px-2 text-xs text-muted-foreground"
        >
          Done
        </Button>
      </div>
    </div>
  );
}
