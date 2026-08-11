"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import { labelsQueryOptions } from "@/lib/query/label-queries";
import {
  customFieldsQueryOptions,
  type CustomFieldRow,
} from "@/lib/query/custom-field-queries";
import {
  FIELD_TYPE_LABEL,
  isChoiceField,
  optionColor,
} from "@/lib/tasks/custom-field-options";
import { addTaskLabel, removeTaskLabel } from "./task-detail-actions";
import { setTaskFieldValue } from "./field-actions";

/**
 * Bulk edit for the list view's selection bar: set a custom field on every
 * selected task, or add/remove a tag across the selection.
 *
 * Each task is written individually through the ordinary single-task action,
 * so every row's Postgres trigger fires and any workflow watching that field
 * or label runs once per task — the same outcome as editing them one by one,
 * which is the behaviour people expect from a bulk edit.
 */

type RunAll = (
  fn: (id: string) => Promise<{ error?: string } | { ok: true }>,
  label: string,
) => void;

export function BulkFieldMenus({
  propertyId,
  ids,
  pending,
  runAll,
}: {
  propertyId: string;
  ids: string[];
  pending: boolean;
  runAll: RunAll;
}) {
  const { data: fields = [] } = useQuery(customFieldsQueryOptions(propertyId));
  const settable = useMemo(
    () => fields.filter((f) => isChoiceField(f.type) || f.type === "checkbox"),
    [fields],
  );

  return (
    <>
      {settable.length > 0 ? (
        <SetFieldMenu
          propertyId={propertyId}
          fields={settable}
          ids={ids}
          pending={pending}
          runAll={runAll}
        />
      ) : null}
      <TagMenu
        propertyId={propertyId}
        ids={ids}
        pending={pending}
        runAll={runAll}
      />
    </>
  );
}

function SetFieldMenu({
  propertyId,
  fields,
  ids,
  pending,
  runAll,
}: {
  propertyId: string;
  fields: CustomFieldRow[];
  ids: string[];
  pending: boolean;
  runAll: RunAll;
}) {
  const [open, setOpen] = useState(false);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const field = fields.find((f) => f.id === fieldId) ?? null;

  function apply(value: string | boolean | string[] | null, label: string) {
    if (!field) return;
    setOpen(false);
    setFieldId(null);
    runAll(
      (taskId) =>
        setTaskFieldValue({ propertyId, taskId, fieldId: field.id, value }),
      label,
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFieldId(null);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={pending || ids.length === 0}
          />
        }
      >
        Set field
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-56 p-1">
        {!field ? (
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {fields.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFieldId(f.id)}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {f.name}
                </span>
                <span className="shrink-0 text-xs text-faint-foreground">
                  {FIELD_TYPE_LABEL[f.type]}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => setFieldId(null)}
              className="px-1.5 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              ← {field.name}
            </button>
            {field.type === "checkbox" ? (
              <>
                <OptionButton
                  label="Checked"
                  onClick={() => apply(true, `${field.name} checked`)}
                />
                <OptionButton
                  label="Unchecked"
                  onClick={() => apply(false, `${field.name} unchecked`)}
                />
              </>
            ) : (
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {field.options.map((o) => (
                  <OptionButton
                    key={o.id}
                    label={o.label}
                    color={optionColor(o)}
                    onClick={() =>
                      apply(
                        // A label field takes an array; a dropdown a bare id.
                        // Bulk-setting a label field REPLACES the selection —
                        // "add to what's there" is the tag menu's job.
                        field.type === "multi_select" ? [o.id] : o.id,
                        `${field.name} set to ${o.label}`,
                      )
                    }
                  />
                ))}
              </div>
            )}
            <OptionButton
              label="Clear"
              muted
              onClick={() => apply(null, `${field.name} cleared`)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function OptionButton({
  label,
  color,
  muted,
  onClick,
}: {
  label: string;
  color?: string;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent",
        muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {color ? (
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            LABEL_DOT[color as keyof typeof LABEL_DOT],
          )}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function TagMenu({
  propertyId,
  ids,
  pending,
  runAll,
}: {
  propertyId: string;
  ids: string[];
  pending: boolean;
  runAll: RunAll;
}) {
  const { data: catalog = [] } = useQuery(labelsQueryOptions(propertyId));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  function add(name: string) {
    setOpen(false);
    setDraft("");
    runAll(async (taskId) => {
      const res = await addTaskLabel({ taskId, label: name });
      // "Already added" is the desired end state for a bulk add, not a failure.
      if ("error" in res && res.error === "Label already added") {
        return { ok: true } as const;
      }
      return res;
    }, `Tagged "${name}"`);
  }

  function remove(name: string) {
    setOpen(false);
    runAll((taskId) => removeTaskLabel(taskId, name), `Removed "${name}"`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={pending || ids.length === 0}
          />
        }
      >
        Tag
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-56 p-1">
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {catalog.length === 0 ? (
            <p className="px-2 py-2 text-center text-xs text-muted-foreground">
              No tags in this property yet.
            </p>
          ) : (
            catalog.map((l) => (
              <div key={l.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => add(l.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      LABEL_DOT[l.color],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {l.name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(l.name)}
                  aria-label={`Remove ${l.name} from selection`}
                  className="shrink-0 rounded-md px-1.5 py-1 text-xs text-faint-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
        <div className="mt-1 border-t border-border pt-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                e.preventDefault();
                add(draft.trim());
              }
            }}
            placeholder="New tag…"
            maxLength={40}
            className="h-7 text-xs"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
