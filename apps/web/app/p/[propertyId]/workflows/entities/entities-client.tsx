"use client";

import { useState } from "react";
import { Gi } from "@/components/gr8r/icon";
import { WfEmpty } from "@/components/workflows/g8-bits";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Database, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

type EntityType = {
  id: string;
  name: string;
  display_name: string;
  schema: Record<string, unknown> | null;
  display_config: Record<string, unknown> | null;
  created_at: string;
};

type FieldDraft = {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  description?: string;
  required: boolean;
};

export function EntitiesClient({
  propertyId,
  initialTypes,
}: {
  propertyId: string;
  initialTypes: EntityType[];
}) {
  const router = useRouter();
  const [types, setTypes] = useState(initialTypes);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Workflow-defined entities — rooms, guests, bookings. Workflows can
          create / read / react to them.
        </span>
        <span className="sp" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>
          <Gi icon={Plus} size={14} />
          New type
        </button>
      </div>

      {types.length > 0 ? (
        <ul className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {types.map((t) => (
            <li key={t.id}>
              <Link
                href={`/p/${propertyId}/workflows/entities/${t.name}`}
                className="nrow"
                style={{ alignItems: "center" }}
              >
                <span className="faint" style={{ display: "inline-flex" }}>
                  <Gi icon={Database} />
                </span>
                <span className="trunc grow" style={{ fontWeight: 500 }}>
                  {t.display_name}
                </span>
                <span className="mono faint" style={{ fontSize: 12 }}>
                  {t.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <WfEmpty icon={Database} title="No entity types yet">
          Create one — or build a workflow and let AI propose one when it’s
          useful.
        </WfEmpty>
      )}

      {creating ? (
        <CreateTypeDialog
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={async (draft) => {
            setBusy(true);
            try {
              const res = await fetch(
                `/api/properties/${propertyId}/entities/types`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: draft.name,
                    display_name: draft.display_name,
                    fields: Object.fromEntries(
                      draft.fields.map((f) => [
                        f.name,
                        {
                          type: f.type,
                          description: f.description,
                          required: f.required,
                        },
                      ]),
                    ),
                  }),
                },
              );
              if (!res.ok) {
                const err = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                throw new Error(err.error ?? `HTTP ${res.status}`);
              }
              const created = (await res.json()) as EntityType;
              setTypes((prev) => [...prev, created]);
              setCreating(false);
              toast.success(`Created "${created.display_name}"`);
              router.refresh();
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

function CreateTypeDialog({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (draft: {
    name: string;
    display_name: string;
    fields: FieldDraft[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([
    { name: "", type: "string", required: false },
  ]);

  function updateField(idx: number, patch: Partial<FieldDraft>) {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }
  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }
  function addField() {
    setFields((prev) => [...prev, { name: "", type: "string", required: false }]);
  }

  const canSubmit =
    name.match(/^[a-z][a-z0-9_]*$/) &&
    displayName.trim().length > 0 &&
    fields.every((f) => f.name.match(/^[a-z][a-z0-9_]*$/));

  return (
    <>
      <div className="scrim enter" />
      <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="New entity type">
        <div className="modal enter" style={{ maxWidth: 520 }}>
          <div className="modal-h">
            <h2>New entity type</h2>
            <button type="button" className="ibtn ibtn-sm" onClick={onCancel} aria-label="Close">
              <Gi icon={X} size={15} />
            </button>
          </div>

          <div className="modal-b">
            <label className="field">
              <span className="label">Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Room"
                className="input"
              />
            </label>
            <label className="field">
              <span className="label">Machine name (snake_case)</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="room"
                className="input mono"
              />
            </label>
            <div className="field">
              <span className="label">Fields</span>
              <ul className="stack" style={{ gap: 6, listStyle: "none", margin: 0, padding: 0 }}>
                {fields.map((f, i) => (
                  <li key={i} className="row" style={{ gap: 6 }}>
                    <input
                      type="text"
                      value={f.name}
                      aria-label="Field name"
                      onChange={(e) => updateField(i, { name: e.target.value })}
                      placeholder="number"
                      className="input mono grow"
                    />
                    <select
                      aria-label="Field type"
                      value={f.type}
                      onChange={(e) =>
                        updateField(i, {
                          type: e.target.value as FieldDraft["type"],
                        })
                      }
                      className="select"
                      style={{ width: "auto" }}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="string[]">string[]</option>
                    </select>
                    <label className="row muted" style={{ gap: 4, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={f.required}
                        onChange={(e) => updateField(i, { required: e.target.checked })}
                      />
                      req
                    </label>
                    <button
                      type="button"
                      className="ibtn ibtn-sm"
                      onClick={() => removeField(i)}
                      aria-label="Remove field"
                    >
                      <Gi icon={Trash2} size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <div>
                <button type="button" onClick={addField} className="btn btn-ghost btn-sm">
                  <Gi icon={Plus} size={14} /> Add field
                </button>
              </div>
            </div>
          </div>

          <div className="modal-f">
            <span className="sp" />
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit || busy}
              onClick={() =>
                onSubmit({
                  name,
                  display_name: displayName,
                  fields: fields.filter((f) => f.name.length > 0),
                })
              }
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
