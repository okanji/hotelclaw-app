"use client";

import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { LABEL_CHIP, LABEL_DOT } from "@/components/labels/label-tokens";
import { optionColor, selectedOptions } from "@/lib/tasks/custom-field-options";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CustomFieldOption, CustomFieldValue } from "@/lib/db/types";

/**
 * The one rendering of a dropdown / label option: an entity chip in the
 * option's colour. Shared by the task sidebar, the list view cells and the
 * bulk-edit bar so an option looks the same everywhere it appears.
 */
export function OptionChip({
  option,
  className,
}: {
  option: CustomFieldOption;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full shrink-0 items-center rounded-pill px-1.5 text-xs font-medium whitespace-nowrap",
        LABEL_CHIP[optionColor(option)],
        className,
      )}
    >
      <span className="truncate">{option.label}</span>
    </span>
  );
}

/**
 * The ticklist behind a label (multi_select) field. Deliberately a Popover of
 * plain buttons rather than a DropdownMenu: ticking three labels shouldn't
 * close the menu three times, and base-ui's menu items close on click by
 * default.
 */
export function OptionTickList({
  options,
  selectedIds,
  onToggle,
  disabled,
  emptyHint,
}: {
  options: CustomFieldOption[];
  selectedIds: string[];
  onToggle: (optionId: string) => void;
  disabled?: boolean;
  emptyHint?: string;
}) {
  if (options.length === 0) {
    return (
      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
        {emptyHint ?? "This field has no options yet."}
      </p>
    );
  }
  return (
    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
      {options.map((o) => {
        const on = selectedIds.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(o.id)}
            aria-pressed={on}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                LABEL_DOT[optionColor(o)],
              )}
            />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {o.label}
            </span>
            {on ? (
              <Check className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Chips + picker for one label field on one task. `onSave` receives the full
 * new id array (or null when the last chip is removed), matching
 * `setTaskFieldValue`'s contract.
 */
export function LabelsValueEditor({
  field,
  value,
  disabled,
  onSave,
  align = "end",
  triggerClassName,
  singleLine,
}: {
  field: { options: CustomFieldOption[] };
  value: CustomFieldValue | null;
  disabled?: boolean;
  onSave: (value: string[] | null) => void;
  align?: "start" | "end";
  triggerClassName?: string;
  /**
   * Keep every chip on one line and clip the overflow. Table cells need this —
   * wrapping chips grow the row and break the fixed row rhythm — while the
   * task sidebar has the vertical room to wrap.
   */
  singleLine?: boolean;
}) {
  const chosen = selectedOptions(field, value);
  const chosenIds = chosen.map((o) => o.id);

  function toggle(optionId: string) {
    const next = chosenIds.includes(optionId)
      ? chosenIds.filter((id) => id !== optionId)
      : [...chosenIds, optionId];
    onSave(next.length === 0 ? null : next);
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-accent",
              singleLine && "overflow-hidden",
              triggerClassName,
            )}
          />
        }
      >
        {chosen.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Plus className="size-3" />
            Add
          </span>
        ) : (
          <span
            className={cn(
              "flex min-w-0 items-center gap-1",
              singleLine ? "overflow-hidden" : "flex-wrap",
            )}
          >
            {chosen.map((o) => (
              <OptionChip key={o.id} option={o} />
            ))}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-56 p-1">
        <OptionTickList
          options={field.options}
          selectedIds={chosenIds}
          onToggle={toggle}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
}
