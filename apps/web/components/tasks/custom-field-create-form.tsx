"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  COMMON_CURRENCIES,
  FIELD_TYPE_HINT,
  FIELD_TYPE_LABEL,
  FIELD_TYPE_ORDER,
  isChoiceField,
  parseOptionsInput,
} from "@/lib/tasks/custom-field-options";
import { createCustomField } from "./field-actions";
import { FIELD_TYPE_ICON } from "./field-type-icon";
import type { CustomFieldConfig, CustomFieldType } from "@/lib/db/types";
import { useStatusCatalog } from "@/lib/query/status-queries";

/**
 * The create-a-custom-field form, shared by the task sidebar's "Add field"
 * popover and the list view's "add column" panel — ClickUp offers field
 * creation from both places, and two copies of this form would drift.
 */

/** Kept for existing importers — the shared map lives in field-type-icon.ts. */
export const TYPE_ICON = FIELD_TYPE_ICON;

const SUGGESTED: {
  name: string;
  type: CustomFieldType;
  options?: string;
  config?: CustomFieldConfig;
}[] = [
  { name: "Cost", type: "currency", config: { code: "KES", precision: 2 } },
  { name: "Requester", type: "people", config: { multiple: false } },
  { name: "Quote", type: "files" },
  { name: "LPO", type: "files" },
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
  // Per-type settings (0116).
  const [currencyCode, setCurrencyCode] = useState("KES");
  const [precision, setPrecision] = useState(2);
  const [multiplePeople, setMultiplePeople] = useState(true);
  const [targetListId, setTargetListId] = useState("");
  const catalog = useStatusCatalog(propertyId);
  const liveLists = catalog.lists.filter((l) => !l.archived_at);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const options = isChoiceField(type) ? parseOptionsInput(optionsText) : [];
      const config: CustomFieldConfig =
        type === "currency"
          ? { code: currencyCode, precision }
          : type === "people"
            ? { multiple: multiplePeople }
            : type === "relation" && targetListId
              ? { target_list_id: targetListId }
              : {};
      const res = await createCustomField({
        propertyId,
        name: trimmed,
        type,
        options,
        config,
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
        {FIELD_TYPE_ORDER.map((t) => {
          const Icon = FIELD_TYPE_ICON[t];
          return (
            <button
              key={t}
              type="button"
              title={FIELD_TYPE_HINT[t]}
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

      <p className="-mt-1 text-xs text-faint-foreground">{FIELD_TYPE_HINT[type]}</p>

      {type === "currency" ? (
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="cf-currency" className="text-xs">
              Currency
            </Label>
            <Input
              id="cf-currency"
              list="cf-currency-codes"
              value={currencyCode}
              onChange={(e) =>
                setCurrencyCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))
              }
              className="h-8 uppercase"
            />
            <datalist id="cf-currency-codes">
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="flex w-24 flex-col gap-1.5">
            <Label htmlFor="cf-precision" className="text-xs">
              Decimals
            </Label>
            <Input
              id="cf-precision"
              type="number"
              min={0}
              max={4}
              value={precision}
              onChange={(e) => setPrecision(Math.max(0, Math.min(4, Number(e.target.value) || 0)))}
              className="h-8"
            />
          </div>
        </div>
      ) : null}

      {type === "people" ? (
        <label className="flex items-center gap-2 text-xs text-faint-foreground">
          <Checkbox
            checked={multiplePeople}
            onCheckedChange={(c) => setMultiplePeople(c === true)}
          />
          Allow several people
        </label>
      ) : null}

      {type === "relation" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-target" className="text-xs">
            Link to tasks in
          </Label>
          <select
            id="cf-target"
            value={targetListId}
            onChange={(e) => setTargetListId(e.target.value)}
            className="h-8 rounded-md bg-transparent px-2 text-sm shadow-ring focus-visible:shadow-focus focus-visible:outline-none"
          >
            <option value="">Any list</option>
            {liveLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
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
                if (sug.config?.code) setCurrencyCode(sug.config.code);
                if (sug.config?.multiple !== undefined) setMultiplePeople(sug.config.multiple);
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
