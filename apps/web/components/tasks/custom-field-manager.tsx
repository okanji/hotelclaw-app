"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  FIELD_TYPE_LABEL,
  isChoiceField,
  optionsToText,
  parseOptionsInput,
} from "@/lib/tasks/custom-field-options";
import { OptionChip } from "./custom-field-chip";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import {
  customFieldsQueryOptions,
  type CustomFieldRow,
} from "@/lib/query/custom-field-queries";
import { updateCustomField } from "./field-actions";

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

  // Usage counts — head-only count per field (definitions are few).
  const { data: usage = {} } = useQuery({
    queryKey: ["custom-field-usage", propertyId, fields.length] as const,
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

  const spaceName = (id: string | null) =>
    id ? (spaces.find((s) => s.id === id)?.name ?? "One team") : "All tasks";

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ["custom-fields", propertyId],
    });
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
        {fields.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            No custom fields yet — add one from a task&rsquo;s sidebar.
          </p>
        ) : (
          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
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
  const [optionsText, setOptionsText] = useState(() =>
    optionsToText(field.options),
  );
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

  function commitOptions() {
    setEditingOptions(false);
    // Existing option ids and colours survive an edit — `parseOptionsInput`
    // matches by label, so stored task values never break on a re-order or a
    // one-word addition.
    const next = parseOptionsInput(optionsText, field.options);
    if (next.length === 0) {
      setOptionsText(optionsToText(field.options));
      return;
    }
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
          // A textarea, not an input: options are one-per-line so a column
          // pasted from a spreadsheet lands correctly. Enter therefore adds an
          // option rather than committing — Escape/blur commits.
          <Textarea
            autoFocus
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            onBlur={commitOptions}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
            disabled={pending}
            rows={Math.min(8, Math.max(3, field.options.length))}
            className="text-xs"
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
