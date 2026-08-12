"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FORM_SOURCE_KINDS,
  SOURCE_KIND_META,
  newFieldId,
  parseFormSchema,
  type FormField,
  type FormFieldType,
  type FormSchema,
  type FormSourceKind,
} from "@/lib/forms/schema";

/**
 * Builder companions used by the Build tab: the propose-then-apply AI edit
 * popover and the "Options from" data-source picker for choice fields.
 */

/** A pre-configured new field from the Add-question menu — task-property
 *  entries arrive with taskProperty / options / source already set. */
export type FieldPreset = Partial<Omit<FormField, "id">> & {
  type: FormFieldType;
};

export type BuilderShared = {
  propertyId: string;
  formId: string;
  canEdit: boolean;
  schema: FormSchema;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  patchField: (id: string, patch: Partial<FormField>) => void;
  addField: (preset: FieldPreset) => void;
  duplicateField: (id: string) => void;
  removeField: (id: string) => void;
  reorder: (activeId: string, overId: string) => void;
  /** Replace the whole working schema (AI edit). */
  applySchema: (schema: FormSchema) => void;
  dirty: boolean;
  saving: boolean;
  save: () => void;
};

/**
 * Propose-then-apply AI editing: describe a change, the model returns a
 * revised schema (stable field ids preserved server-side), and it lands in
 * the working copy — visible on the canvas but not persisted until Save.
 */
export function AiEditPopover({ shared }: { shared: BuilderShared }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, startTransition] = useTransition();

  function run() {
    const instruction = prompt.trim();
    if (!instruction) return;
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/properties/${shared.propertyId}/forms/${shared.formId}/edit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: instruction, schema: shared.schema }),
          },
        );
        const json = (await res.json()) as { schema?: unknown; error?: string };
        if (!res.ok || !json.schema) {
          toast.error(json.error ?? "AI edit failed");
          return;
        }
        shared.applySchema(parseFormSchema(json.schema));
        toast.success("Changes applied — review and Save");
        setPrompt("");
        setOpen(false);
      } catch {
        toast.error("AI edit failed");
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Sparkles data-slot="icon" />
        Edit with AI
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2">
        <p className="text-sm font-medium">Describe a change</p>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="e.g. add a priority dropdown after the description, and make the room field required"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run();
            }
          }}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={run} disabled={busy || !prompt.trim()}>
            {busy ? <Loader2 data-slot="icon" className="animate-spin" /> : null}
            {busy ? "Thinking…" : "Apply"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* --------------------------- Source picker ------------------------------- */

type SheetRef = { id: string; label: string };

/**
 * "Options from" — bind a choice field's options to live app data
 * (members / projects / tasks / teams / labels / a spreadsheet column)
 * instead of a hand-typed list. Sheets get a document + column picker.
 */
export function SourcePicker({
  propertyId,
  field,
  onPatch,
}: {
  propertyId: string;
  field: FormField;
  onPatch: (patch: Partial<FormField>) => void;
}) {
  const [sheets, setSheets] = useState<SheetRef[] | null>(null);
  const kind = field.source?.kind ?? "custom";
  const sheetDocId =
    field.source?.kind === "sheet_column" ? (field.source.documentId ?? null) : null;

  // Columns are keyed by the picked sheet — reset during render when the
  // sheet changes, fetch in the effect.
  const [columnsState, setColumnsState] = useState<{
    docId: string | null;
    columns: SheetRef[] | null;
  }>({ docId: null, columns: null });
  if (columnsState.docId !== sheetDocId) {
    setColumnsState({ docId: sheetDocId, columns: null });
  }
  const columns = columnsState.columns;

  useEffect(() => {
    if (field.source?.kind !== "sheet_column") return;
    let cancelled = false;
    void fetch(`/api/properties/${propertyId}/forms/options?kind=sheet_column`)
      .then(async (res) => (await res.json()) as { sheets?: SheetRef[] })
      .then((json) => {
        if (!cancelled) setSheets(json.sheets ?? []);
      })
      .catch(() => {
        if (!cancelled) setSheets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, field.source?.kind]);

  useEffect(() => {
    if (!sheetDocId) return;
    let cancelled = false;
    void fetch(
      `/api/properties/${propertyId}/forms/options?kind=sheet_column&documentId=${sheetDocId}`,
    )
      .then(async (res) => (await res.json()) as { columns?: SheetRef[] })
      .then((json) => {
        if (!cancelled) setColumnsState({ docId: sheetDocId, columns: json.columns ?? [] });
      })
      .catch(() => {
        if (!cancelled) setColumnsState({ docId: sheetDocId, columns: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, sheetDocId]);

  function setKind(next: string) {
    if (next === "custom") {
      onPatch({
        source: undefined,
        options: field.options?.length
          ? field.options
          : [
              { id: newFieldId(), label: "Option 1" },
              { id: newFieldId(), label: "Option 2" },
            ],
      });
      return;
    }
    onPatch({ source: { kind: next as FormSourceKind }, options: undefined });
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Options from</Label>
      <SmallSelect value={kind} onChange={setKind} ariaLabel="Options source">
        <option value="custom">Custom list</option>
        {FORM_SOURCE_KINDS.map((k) => (
          <option key={k} value={k}>
            {SOURCE_KIND_META[k].label}
          </option>
        ))}
      </SmallSelect>

      {field.source?.kind === "sheet_column" ? (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <SmallSelect
            value={field.source.documentId ?? ""}
            ariaLabel="Spreadsheet"
            onChange={(documentId) =>
              onPatch({
                source: { kind: "sheet_column", documentId: documentId || undefined },
              })
            }
          >
            <option value="">
              {sheets === null ? "Loading sheets…" : sheets.length ? "Pick a sheet…" : "No sheets yet"}
            </option>
            {(sheets ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </SmallSelect>
          <SmallSelect
            value={field.source.column ?? ""}
            ariaLabel="Column"
            onChange={(column) =>
              onPatch({
                source: {
                  kind: "sheet_column",
                  documentId: field.source?.documentId,
                  column: column || undefined,
                },
              })
            }
          >
            <option value="">
              {!field.source.documentId
                ? "Sheet first"
                : columns === null
                  ? "Loading…"
                  : "Pick a column…"}
            </option>
            {(columns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SmallSelect>
        </div>
      ) : null}

      {field.source && field.source.kind !== "sheet_column" ? (
        <p className="text-xs text-muted-foreground">
          {SOURCE_KIND_META[field.source.kind].description}
        </p>
      ) : null}
    </div>
  );
}

function SmallSelect({
  value,
  onChange,
  children,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <NativeSelect
      value={value}
      aria-label={ariaLabel}
      name={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </NativeSelect>
  );
}
