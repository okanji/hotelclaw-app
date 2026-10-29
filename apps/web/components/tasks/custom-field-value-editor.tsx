"use client";

import {
  FilesFieldEditor,
  PeopleFieldEditor,
  ProgressFieldDisplay,
  RelationFieldEditor,
  ValidatedTextEditor,
  type FieldEditorContext,
} from "./custom-field-rich-editors";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CustomFieldRow } from "@/lib/query/custom-field-queries";
import type { CustomFieldValue } from "@/lib/db/types";
import { LabelsValueEditor, OptionChip } from "./custom-field-chip";

/**
 * The editor for ONE custom-field value, shared by the task detail sidebar and
 * the list view's cells. Both surfaces write through `setTaskFieldValue`, so
 * whichever one you edit from, the Postgres trigger emits `task.field_changed`
 * and any workflow watching that field runs.
 *
 * `align` follows the surface: the sidebar's menus open to the right edge of a
 * narrow rail, a table cell's open under its left edge.
 */
export function CustomFieldValueEditor({
  field,
  value,
  disabled,
  onSave,
  align = "end",
  placeholder = "None",
  singleLine,
  context,
}: {
  field: CustomFieldRow;
  value: CustomFieldValue | null;
  disabled?: boolean;
  onSave: (value: CustomFieldValue | null) => void;
  align?: "start" | "end";
  placeholder?: string;
  /** Table cells keep label chips on one line; the sidebar wraps them. */
  singleLine?: boolean;
  /** The task being edited — people / relation / files / progress need it. */
  context?: FieldEditorContext;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  // 0116 types that read other data (members, tasks, attachments).
  if (context) {
    if (field.type === "people") {
      return (
        <PeopleFieldEditor field={field} value={value} ctx={context} disabled={disabled}
          onSave={onSave} align={align} placeholder={placeholder} />
      );
    }
    if (field.type === "relation") {
      return (
        <RelationFieldEditor field={field} value={value} ctx={context} disabled={disabled}
          onSave={onSave} align={align} placeholder={placeholder} />
      );
    }
    if (field.type === "files") {
      return (
        <FilesFieldEditor field={field} value={value} ctx={context} disabled={disabled}
          placeholder={placeholder} singleLine={singleLine} />
      );
    }
    if (field.type === "progress") return <ProgressFieldDisplay ctx={context} />;
  } else if (
    field.type === "people" ||
    field.type === "relation" ||
    field.type === "files" ||
    field.type === "progress"
  ) {
    // No task context (shouldn't happen on today's surfaces) — read-only text.
    return (
      <span className="px-1.5 text-sm text-muted-foreground">
        {Array.isArray(value) && value.length ? `${value.length} set` : placeholder}
      </span>
    );
  }

  if (
    field.type === "currency" ||
    field.type === "url" ||
    field.type === "email" ||
    field.type === "phone" ||
    field.type === "long_text"
  ) {
    return (
      <ValidatedTextEditor field={field} value={value} disabled={disabled}
        onSave={onSave} placeholder={placeholder} />
    );
  }

  if (field.type === "checkbox") {
    return (
      <Checkbox
        checked={value === true}
        disabled={disabled}
        onCheckedChange={(c) => onSave(c === true)}
      />
    );
  }

  // Labels — several options at once, drawn as chips. The picker stays open
  // while you tick, because choosing three labels shouldn't cost three
  // round-trips through the menu.
  if (field.type === "multi_select") {
    return (
      <LabelsValueEditor
        field={field}
        value={value}
        disabled={disabled}
        onSave={onSave}
        align={align}
        singleLine={singleLine}
      />
    );
  }

  if (field.type === "select") {
    const current = field.options.find((o) => o.id === value);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-sm transition-colors hover:bg-accent",
                current ? "text-foreground" : "text-muted-foreground",
              )}
            />
          }
        >
          <span className="min-w-0 flex-1 truncate">
            {current ? <OptionChip option={current} /> : placeholder}
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {field.options.map((o) => (
            <DropdownMenuItem key={o.id} onClick={() => onSave(o.id)}>
              <OptionChip option={o} />
            </DropdownMenuItem>
          ))}
          {current ? (
            <DropdownMenuItem
              onClick={() => onSave(null)}
              className="text-muted-foreground"
            >
              Clear
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (field.type === "date") {
    return (
      <input
        type="date"
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(e) => onSave(e.target.value ? e.target.value : null)}
        className="w-full rounded-md bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none hover:bg-accent [color-scheme:light] dark:[color-scheme:dark]"
      />
    );
  }

  // text / number — draft locally, commit on blur or Enter.
  const display = draft ?? (value === null ? "" : String(value));
  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (trimmed === "") {
      if (value !== null) onSave(null);
      return;
    }
    if (field.type === "number") {
      // Plain decimal only — Number("0x10") is 16 and Number("1e999") is
      // Infinity, neither of which anyone typed into a Cost field on purpose.
      const n = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)
        ? Number(trimmed)
        : NaN;
      if (!Number.isFinite(n)) {
        toast.error("Not a number");
        return;
      }
      if (n !== value) onSave(n);
      return;
    }
    if (trimmed !== value) onSave(trimmed);
  };
  return (
    <input
      type={field.type === "number" ? "number" : "text"}
      value={display}
      placeholder="—"
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className="w-full rounded-md bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground hover:bg-accent focus:bg-accent"
    />
  );
}
