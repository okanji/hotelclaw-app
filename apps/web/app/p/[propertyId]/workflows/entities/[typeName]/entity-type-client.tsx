"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type EntityType = {
  id: string;
  name: string;
  display_name: string;
  schema: Record<string, unknown>;
};

type EntityRow = {
  id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type FieldSpec = { type: string; description?: string };

function fieldsFromSchema(schema: Record<string, unknown>): Array<{
  name: string;
  spec: FieldSpec;
  required: boolean;
}> {
  const props = (schema.properties as Record<string, FieldSpec> | undefined) ?? {};
  const required = (schema.required as string[] | undefined) ?? [];
  return Object.entries(props).map(([name, spec]) => ({
    name,
    spec: spec as FieldSpec,
    required: required.includes(name),
  }));
}

function primaryFieldOf(schema: Record<string, unknown>): string | null {
  const fields = fieldsFromSchema(schema);
  if (fields.length === 0) return null;
  const named = fields.find((f) => ["name", "title", "number", "label"].includes(f.name));
  return (named ?? fields[0]).name;
}

export function EntityTypeClient({
  propertyId,
  type,
  initialRows,
}: {
  propertyId: string;
  type: EntityType;
  initialRows: EntityRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const fields = fieldsFromSchema(type.schema);
  const primary = primaryFieldOf(type.schema);

  return (
    <>
      <header className="mb-4 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "row" : "rows"} · field map: {fields.map((f) => f.name).join(", ") || "none"}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
        >
          <Plus className="size-3.5" />
          New {type.display_name.toLowerCase()}
        </button>
      </header>

      {rows.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-2 hover:bg-muted/40">
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-medium text-foreground">
                  {primary ? String(r.data[primary] ?? "—") : r.id.slice(0, 8)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {Object.entries(r.data).map(([k, v]) =>
                  k === primary ? null : (
                    <span
                      key={k}
                      className="rounded bg-muted/40 px-1.5 py-0.5 font-mono"
                    >
                      {k}: {valuePreview(v)}
                    </span>
                  ),
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-border/60 bg-muted/15 p-8 text-center text-sm text-muted-foreground">
          No rows yet.
        </div>
      )}

      {creating ? (
        <CreateEntityDialog
          type={type}
          fields={fields}
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={async (data) => {
            setBusy(true);
            try {
              const res = await fetch(
                `/api/properties/${propertyId}/entities`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ type: type.name, data }),
                },
              );
              if (!res.ok) {
                const err = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                throw new Error(err.error ?? `HTTP ${res.status}`);
              }
              const created = (await res.json()) as EntityRow;
              setRows((prev) => [created, ...prev]);
              setCreating(false);
              toast.success(`Added ${type.display_name.toLowerCase()}`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Create failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function valuePreview(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(", ");
  return JSON.stringify(v);
}

function CreateEntityDialog({
  type,
  fields,
  busy,
  onCancel,
  onSubmit,
}: {
  type: EntityType;
  fields: Array<{ name: string; spec: FieldSpec; required: boolean }>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  function set(field: string, value: unknown) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  const canSubmit = fields
    .filter((f) => f.required)
    .every((f) => values[f.name] !== undefined && values[f.name] !== "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-full max-w-[480px] rounded-lg border border-border bg-card p-5 shadow-lg">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            New {type.display_name.toLowerCase()}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="size-3.5" />
          </button>
        </header>

        <div className="space-y-3">
          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This type has no defined fields — entities will be empty objects.
            </p>
          ) : (
            fields.map((f) => (
              <FieldInput key={f.name} field={f} value={values[f.name]} onChange={set} />
            ))
          )}
        </div>

        <footer className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={() => onSubmit(values)}
            className={cn(
              "rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50",
            )}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: { name: string; spec: FieldSpec; required: boolean };
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}) {
  const label = (
    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {field.name}
      {field.required ? <span className="ml-1 text-destructive">*</span> : null}
      {field.spec.description ? (
        <span className="ml-2 normal-case text-muted-foreground/80">
          {field.spec.description}
        </span>
      ) : null}
    </label>
  );

  switch (field.spec.type) {
    case "number":
      return (
        <div>
          {label}
          <input
            type="number"
            value={(value as number | undefined) ?? ""}
            onChange={(e) =>
              onChange(field.name, e.target.value === "" ? undefined : Number(e.target.value))
            }
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </div>
      );
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={(value as boolean | undefined) ?? false}
            onChange={(e) => onChange(field.name, e.target.checked)}
          />
          <span className="text-xs text-foreground">{field.name}</span>
        </div>
      );
    case "array":
      return (
        <div>
          {label}
          <input
            type="text"
            placeholder="comma,separated,values"
            value={
              Array.isArray(value)
                ? (value as string[]).join(",")
                : (value as string | undefined) ?? ""
            }
            onChange={(e) =>
              onChange(
                field.name,
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </div>
      );
    case "string":
    default:
      return (
        <div>
          {label}
          <input
            type="text"
            value={(value as string | undefined) ?? ""}
            onChange={(e) => onChange(field.name, e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </div>
      );
  }
}
