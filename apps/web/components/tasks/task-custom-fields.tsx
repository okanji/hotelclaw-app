"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, ChevronDown, Hash, ListFilter, Plus, Text, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { createCustomField, setTaskFieldValue } from "./field-actions";
import type { CustomFieldType, CustomFieldValue } from "@/lib/db/types";

/**
 * "Fields" section of the task detail sidebar — the task-side surface of the
 * custom-fields system (0080). Lists every applicable definition
 * (property-wide + this task's team) with an inline editor per type, plus a
 * quick-create popover. Values save on change; the Postgres trigger emits
 * `task.field_changed` for workflows.
 */

const TYPE_META: Record<CustomFieldType, { label: string; icon: typeof Text }> = {
  text: { label: "Text", icon: Text },
  number: { label: "Number", icon: Hash },
  select: { label: "Dropdown", icon: ListFilter },
  date: { label: "Date", icon: CalendarDays },
  checkbox: { label: "Checkbox", icon: CheckSquare },
};

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
  const Icon = TYPE_META[field.type].icon;
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm">
      <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <span className="w-[38%] min-w-0 shrink-0 truncate text-xs text-faint-foreground">
        {field.name}
      </span>
      <div className="min-w-0 flex-1">
        <FieldValueEditor field={field} value={value} disabled={disabled} onSave={onSave} />
      </div>
    </div>
  );
}

function FieldValueEditor({
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
  const [draft, setDraft] = useState<string | null>(null);

  if (field.type === "checkbox") {
    return (
      <Checkbox
        checked={value === true}
        disabled={disabled}
        onCheckedChange={(c) => onSave(c === true)}
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
            {current?.label ?? "None"}
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {field.options.map((o) => (
            <DropdownMenuItem key={o.id} onClick={() => onSave(o.id)}>
              {o.label}
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
      const n = Number(trimmed);
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

/* ── Quick-create ────────────────────────────────────────────────────────── */

const SUGGESTED: { name: string; type: CustomFieldType; options?: string }[] = [
  { name: "Cost", type: "number" },
  { name: "Location", type: "text" },
  { name: "Sign-off", type: "checkbox" },
  {
    name: "Material status",
    type: "select",
    // The full maintenance procurement ladder (Temple Point flow) — pairs
    // with the "Maintenance material tracking" workflow template.
    options:
      "Request, Preparation, Material check, Quoting, Quote approval, Procurement, LPO approval, Budget check, Budget allocated, Send LPO, Awaiting payment, Awaiting delivery, Ready to schedule, Scheduled, In progress, Ready for review, Finalized payments",
  },
];

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
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [teamOnly, setTeamOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const options =
        type === "select"
          ? optionsText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map((label) => ({
                id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
                label,
              }))
          : [];
      const res = await createCustomField({
        propertyId,
        name: trimmed,
        type,
        options,
        spaceId: teamOnly ? taskSpaceId : null,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setName("");
      setOptionsText("");
      setType("text");
      setOpen(false);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

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
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cf-name" className="text-xs">
              Field name
            </Label>
            <Input
              id="cf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Material status"
              maxLength={60}
              className="h-8"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {(Object.keys(TYPE_META) as CustomFieldType[]).map((t) => {
              const Icon = TYPE_META[t].icon;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    type === t
                      ? "bg-accent-pressed text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <Icon className="size-3" />
                  {TYPE_META[t].label}
                </button>
              );
            })}
          </div>

          {type === "select" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cf-options" className="text-xs">
                Options (comma-separated)
              </Label>
              <Input
                id="cf-options"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="Needed, Quoted, Ordered"
                className="h-8"
              />
            </div>
          ) : null}

          {taskSpaceId ? (
            <label className="flex items-center gap-2 text-xs text-faint-foreground">
              <Checkbox
                checked={teamOnly}
                onCheckedChange={(c) => setTeamOnly(c === true)}
              />
              Only for this task&rsquo;s team
            </label>
          ) : null}

          <div className="flex flex-col gap-1">
            <p className="text-xs/[1] font-medium text-faint-foreground">
              Suggestions
            </p>
            <div className="flex flex-wrap gap-1">
              {SUGGESTED.map((sug) => (
                <button
                  key={sug.name}
                  type="button"
                  onClick={() => {
                    setName(sug.name);
                    setType(sug.type);
                    setOptionsText(sug.options ?? "");
                  }}
                  className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent-pressed hover:text-foreground"
                >
                  {sug.name}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={busy || !name.trim() || (type === "select" && !optionsText.trim())}
          >
            Create field
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
