"use client";

import { useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Database, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
      <header className="mb-4 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Workflow-defined entities — rooms, guests, bookings. Workflows can
          create / read / react to them.
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
        >
          <Plus className="size-3.5" />
          New type
        </button>
      </header>

      {types.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {types.map((t) => (
            <li key={t.id}>
              <Link
                href={`/p/${propertyId}/workflows/entities/${t.name}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
              >
                <Database
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                <span className="flex-1 truncate text-sm font-medium text-foreground">
                  {t.display_name}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {t.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-border/60 bg-muted/15 p-10 text-center">
          <Database
            className="mx-auto mb-3 size-6 text-muted-foreground"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No entity types yet. Create one — or build a workflow and let AI
            propose one when it’s useful.
          </p>
        </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-full max-w-[520px] rounded-lg border border-border bg-card p-5 shadow-lg">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">New entity type</h2>
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
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Display name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Room"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Machine name (snake_case)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="room"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fields
            </label>
            <ul className="flex flex-col gap-1.5">
              {fields.map((f, i) => (
                <li key={i} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={f.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    placeholder="number"
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                  />
                  <NativeSelect
                    aria-label="Field type"
                    value={f.type}
                    onChange={(e) =>
                      updateField(i, {
                        type: e.target.value as FieldDraft["type"],
                      })
                    }
                    wrapperClassName="w-auto"
                    className="h-7 text-xs md:text-xs"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="string[]">string[]</option>
                  </NativeSelect>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                    />
                    req
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    aria-label="Remove field"
                    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addField}
              className="mt-2 inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3" /> Add field
            </button>
          </div>
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
            onClick={() =>
              onSubmit({
                name,
                display_name: displayName,
                fields: fields.filter((f) => f.name.length > 0),
              })
            }
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
