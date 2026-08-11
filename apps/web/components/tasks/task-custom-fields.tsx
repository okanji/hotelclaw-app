"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import {
  customFieldsQueryOptions,
  taskFieldValuesQueryOptions,
  type CustomFieldRow,
} from "@/lib/query/custom-field-queries";
import { CustomFieldValueEditor } from "./custom-field-value-editor";
import { CustomFieldCreateForm, TYPE_ICON } from "./custom-field-create-form";
import { setTaskFieldValue } from "./field-actions";
import type { CustomFieldValue } from "@/lib/db/types";

/**
 * "Fields" section of the task detail sidebar — the task-side surface of the
 * custom-fields system (0080). Lists every applicable definition
 * (property-wide + this task's team) with an inline editor per type, plus a
 * quick-create popover. Values save on change; the Postgres trigger emits
 * `task.field_changed` for workflows.
 */

export function TaskCustomFields({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const queryClient = useQueryClient();
  const { data: fields = [] } = useQuery(customFieldsQueryOptions(propertyId));
  const { data: values = [] } = useQuery(taskFieldValuesQueryOptions(taskId));

  // The task's team decides which team-scoped fields apply.
  const { data: taskSpaceId } = useQuery({
    queryKey: ["task-space", taskId] as const,
    queryFn: async (): Promise<string | null> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("tasks")
        .select("space_id")
        .eq("id", taskId)
        .maybeSingle();
      return data?.space_id ?? null;
    },
    staleTime: 30_000,
  });

  const applicable = useMemo(
    () => fields.filter((f) => !f.space_id || f.space_id === taskSpaceId),
    [fields, taskSpaceId],
  );
  const valueByField = useMemo(
    () => new Map(values.map((v) => [v.field_id, v.value])),
    [values],
  );

  const [pending, startTransition] = useTransition();

  function save(fieldId: string, value: CustomFieldValue | null) {
    startTransition(async () => {
      const res = await setTaskFieldValue({ propertyId, taskId, fieldId, value });
      if ("error" in res) toast.error(res.error);
      await queryClient.invalidateQueries({
        queryKey: ["task-field-values", taskId],
      });
    });
  }

  return (
    <>
      {applicable.map((f) => (
        <FieldRow
          key={f.id}
          field={f}
          value={valueByField.get(f.id) ?? null}
          disabled={pending}
          onSave={(v) => save(f.id, v)}
        />
      ))}
      <AddFieldPopover
        propertyId={propertyId}
        taskSpaceId={taskSpaceId ?? null}
        onCreated={() =>
          void queryClient.invalidateQueries({
            queryKey: ["custom-fields", propertyId],
          })
        }
      />
    </>
  );
}

/* ── Per-type inline editors ─────────────────────────────────────────────── */

function FieldRow({
  field,
  value,
  disabled,
  onSave,
}: {
  field: CustomFieldRow;
  value: CustomFieldValue | null;
  disabled: boolean;
  onSave: (value: CustomFieldValue | null) => void;
}) {
  const Icon = TYPE_ICON[field.type];
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm">
      <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <span className="w-[38%] min-w-0 shrink-0 truncate text-xs text-faint-foreground">
        {field.name}
      </span>
      <div className="min-w-0 flex-1">
        <CustomFieldValueEditor
          field={field}
          value={value}
          disabled={disabled}
          onSave={onSave}
        />
      </div>
    </div>
  );
}

/* ── Quick-create ────────────────────────────────────────────────────────── */

function AddFieldPopover({
  propertyId,
  taskSpaceId,
  onCreated,
}: {
  propertyId: string;
  taskSpaceId: string | null;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
          />
        }
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          <Plus className="size-3.5" />
        </span>
        Add field
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <CustomFieldCreateForm
          propertyId={propertyId}
          taskSpaceId={taskSpaceId}
          onCreated={() => {
            setOpen(false);
            onCreated();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
