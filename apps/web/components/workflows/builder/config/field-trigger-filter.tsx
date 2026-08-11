"use client";

import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { customFieldsQueryOptions } from "@/lib/query/custom-field-queries";
import {
  isChoiceField,
  optionColor,
} from "@/lib/tasks/custom-field-options";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import type { FieldTriggerSelection } from "@/lib/workflows/trigger-filter";

/**
 * "Which custom field, and which value?" for the `task.field_changed`
 * trigger — the counterpart of `LabelTriggerFilter`.
 *
 * Without this the trigger fires on EVERY field change on every task and the
 * only way to narrow it was to hand-build a condition on `trigger.field_name`
 * in the generic builder. ClickUp's equivalent is one dropdown for the field
 * and one for the value it should land on; this is that, sourced from the
 * property's real field definitions so the names always match the payload.
 */
export function FieldTriggerFilter({
  propertyId,
  selection,
  onChange,
  compact,
}: {
  propertyId?: string;
  selection: FieldTriggerSelection;
  onChange: (next: FieldTriggerSelection) => void;
  /** Inside the flow rail — the section title lives on the rail, not here. */
  compact?: boolean;
}) {
  const { data: fields = [], isLoading } = useQuery({
    ...customFieldsQueryOptions(propertyId ?? ""),
    enabled: Boolean(propertyId),
  });

  const field = fields.find((f) => f.name === selection.fieldName) ?? null;
  const options = field && isChoiceField(field.type) ? field.options : [];

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {!compact && (
        <>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-3.5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">Which field?</p>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Pick none to run whenever{" "}
            <span className="text-foreground/90">any</span> custom field
            changes.
          </p>
        </>
      )}

      <div className="space-y-2">
        {!compact && (
          <p className="text-xs font-medium text-faint-foreground">
            {isLoading ? "Loading fields…" : "Custom fields in this property"}
          </p>
        )}
        {fields.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground">
            This property has no custom fields yet. Add one from any task&rsquo;s
            Fields section, or from the list view&rsquo;s add-column button.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {fields.map((f) => {
              const on = selection.fieldName === f.name;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() =>
                    // Changing the field invalidates the value — the options
                    // belong to the old field.
                    onChange(
                      on
                        ? { fieldName: null, toValue: null }
                        : { fieldName: f.name, toValue: null },
                    )
                  }
                  className={cn(
                    "inline-flex h-7 items-center rounded-lg px-2 text-xs font-medium transition-colors",
                    on
                      ? "bg-accent-pressed text-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {f.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {field ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-faint-foreground">
            {options.length > 0
              ? "Run only when it becomes…"
              : field.type === "checkbox"
                ? "Run only when it becomes…"
                : "Runs on any change to this field."}
          </p>
          {options.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {options.map((o) => {
                const on = selection.toValue === o.label;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() =>
                      onChange({
                        fieldName: field.name,
                        toValue: on ? null : o.label,
                      })
                    }
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors",
                      on
                        ? "bg-accent-pressed text-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        LABEL_DOT[optionColor(o)],
                      )}
                    />
                    {o.label}
                  </button>
                );
              })}
            </div>
          ) : field.type === "checkbox" ? (
            <div className="flex flex-wrap gap-1">
              {["true", "false"].map((v) => {
                const on = selection.toValue === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() =>
                      onChange({
                        fieldName: field.name,
                        toValue: on ? null : v,
                      })
                    }
                    className={cn(
                      "inline-flex h-7 items-center rounded-lg px-2 text-xs font-medium transition-colors",
                      on
                        ? "bg-accent-pressed text-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {v === "true" ? "Checked" : "Unchecked"}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
