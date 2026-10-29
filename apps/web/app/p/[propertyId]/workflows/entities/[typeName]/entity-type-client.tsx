"use client";

import { useState } from "react";
import { Database, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Gi } from "@/components/gr8r/icon";
import { WfEmpty } from "@/components/workflows/g8-bits";

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
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {rows.length} {rows.length === 1 ? "row" : "rows"} · field map: {fields.map((f) => f.name).join(", ") || "none"}
        </span>
        <span className="sp" />
        <button type="button" onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
          <Gi icon={Plus} size={14} />
          New {type.display_name.toLowerCase()}
        </button>
      </div>

      {rows.length > 0 ? (
        <ul className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} className="nrow" style={{ flexDirection: "column", gap: 6, cursor: "default" }}>
              <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
                <span style={{ fontWeight: 500 }}>
                  {primary ? String(r.data[primary] ?? "—") : r.id.slice(0, 8)}
                </span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {Object.entries(r.data).map(([k, v]) =>
                  k === primary ? null : (
                    <span key={k} className="badge gray mono">
                      {k}: {valuePreview(v)}
                    </span>
                  ),
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <WfEmpty icon={Database}>No rows yet.</WfEmpty>
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
    <>
      <div className="scrim enter" />
      <div className="modal-wrap" role="dialog" aria-modal="true">
        <div className="modal enter" style={{ maxWidth: 480 }}>
          <div className="modal-h">
            <h2>New {type.display_name.toLowerCase()}</h2>
            <button type="button" onClick={onCancel} aria-label="Close" className="ibtn ibtn-sm">
              <Gi icon={X} size={15} />
            </button>
          </div>

          <div className="modal-b">
            {fields.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                This type has no defined fields — entities will be empty objects.
              </p>
            ) : (
              fields.map((f) => (
                <FieldInput key={f.name} field={f} value={values[f.name]} onChange={set} />
              ))
            )}
          </div>

          <div className="modal-f">
            <span className="sp" />
            <button type="button" onClick={onCancel} className="btn btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit || busy}
              onClick={() => onSubmit(values)}
              className="btn btn-primary"
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </>
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
    <span className="label">
      {field.name}
      {field.required ? <span style={{ marginLeft: 4, color: "var(--g8-red)" }}>*</span> : null}
      {field.spec.description ? (
        <span className="hint" style={{ marginLeft: 8, fontWeight: 400 }}>
          {field.spec.description}
        </span>
      ) : null}
    </span>
  );

  switch (field.spec.type) {
    case "number":
      return (
        <label className="field">
          {label}
          <input
            type="number"
            value={(value as number | undefined) ?? ""}
            onChange={(e) =>
              onChange(field.name, e.target.value === "" ? undefined : Number(e.target.value))
            }
            className="input"
          />
        </label>
      );
    case "boolean":
      return (
        <label className="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={(value as boolean | undefined) ?? false}
            onChange={(e) => onChange(field.name, e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>{field.name}</span>
        </label>
      );
    case "array":
      return (
        <label className="field">
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
            className="input"
          />
        </label>
      );
    case "string":
    default:
      return (
        <label className="field">
          {label}
          <input
            type="text"
            value={(value as string | undefined) ?? ""}
            onChange={(e) => onChange(field.name, e.target.value)}
            className="input"
          />
        </label>
      );
  }
}
