"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckSquare,
  Hash,
  ListFilter,
  Tags,
  Text,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FIELD_TYPE_LABEL,
  isChoiceField,
  parseOptionsInput,
} from "@/lib/tasks/custom-field-options";
import { createCustomField } from "./field-actions";
import type { CustomFieldType } from "@/lib/db/types";

/**
 * The create-a-custom-field form, shared by the task sidebar's "Add field"
 * popover and the list view's "add column" panel — ClickUp offers field
 * creation from both places, and two copies of this form would drift.
 */

export const TYPE_ICON: Record<CustomFieldType, typeof Text> = {
  text: Text,
  number: Hash,
  select: ListFilter,
  multi_select: Tags,
  date: CalendarDays,
  checkbox: CheckSquare,
};

const SUGGESTED: { name: string; type: CustomFieldType; options?: string }[] = [
  { name: "Cost", type: "number" },
  { name: "Location", type: "text" },
  { name: "Sign-off", type: "checkbox" },
  {
    name: "Department",
    type: "multi_select",
    options: "Front desk, Housekeeping, Maintenance, F&B, Security",
  },
  {
    name: "Material status",
    // The full maintenance procurement ladder (Temple Point flow) — pairs
    // with the "Maintenance material tracking" workflow template.
    type: "select",
    options:
      "Request, Preparation, Material check, Quoting, Quote approval, Procurement, LPO approval, Budget check, Budget allocated, Send LPO, Awaiting payment, Awaiting delivery, Ready to schedule, Scheduled, In progress, Ready for review, Finalized payments",
  },
];

export function CustomFieldCreateForm({
  propertyId,
  taskSpaceId,
  onCreated,
  submitLabel = "Create field",
}: {
  propertyId: string;
  /** When set, the form offers to scope the field to that team. */
  taskSpaceId: string | null;
  onCreated: (fieldId: string) => void;
  submitLabel?: string;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [teamOnly, setTeamOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const options = isChoiceField(type) ? parseOptionsInput(optionsText) : [];
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
      // Every caller needs the definition list refreshed before it can use the
      // new field — the list view's add-column path in particular resolves
      // `field:<id>` columns against this cache and silently drops ids it
      // hasn't seen, so a freshly created column would not render.
      await queryClient.invalidateQueries({
        queryKey: ["custom-fields", propertyId],
      });
      setName("");
      setOptionsText("");
      setType("text");
      onCreated(res.id);
    } finally {
      setBusy(false);
    }
  }

  return (
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
        {(Object.keys(TYPE_ICON) as CustomFieldType[]).map((t) => {
          const Icon = TYPE_ICON[t];
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
              {FIELD_TYPE_LABEL[t]}
            </button>
          );
        })}
      </div>

      {isChoiceField(type) ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-options" className="text-xs">
            Options
          </Label>
          <Textarea
            id="cf-options"
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder="Needed, Quoted, Ordered"
            rows={3}
            className="text-sm"
          />
          <p className="text-xs text-faint-foreground">
            One per line, or comma-separated. Paste a column from a sheet to
            add them in bulk.
          </p>
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
        disabled={
          busy || !name.trim() || (isChoiceField(type) && !optionsText.trim())
        }
      >
        {submitLabel}
      </Button>
    </div>
  );
}
