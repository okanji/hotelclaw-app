"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Globe, Play, Plus, Trash2 } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Chip } from "@/components/ui/chip";
import { saveCustomAction, deleteCustomAction } from "./actions";

/** Client-safe row — header secrets never leave the server. */
export type CustomActionListItem = {
  id: string;
  name: string;
  when_to_use: string | null;
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headerNames: string[];
  body_template: string | null;
  param_schema: ParamField[];
  response_allowlist: string[];
  enabled: boolean;
};

type ParamField = {
  id: string;
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
};

type HeaderDraft = { name: string; value: string; saved: boolean };

function newParamId() {
  return `p_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Custom HTTP actions — Chatbase parity. Each action becomes a tool: the
 * bot collects the declared parameters from the guest and we call the URL
 * server-side (HTTPS-only, SSRF-guarded, 20KB cap, response fields
 * allowlisted before the model sees them).
 */
export function CustomActionsPanel({
  propertyId,
  chatbotId,
  actions,
}: {
  propertyId: string;
  chatbotId: string;
  actions: CustomActionListItem[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CustomActionListItem | "new" | null>(null);

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <div className="grow">
          <h2 className="sec">Custom API actions</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Connect the bot to your own systems — a booking engine, PMS, or
            any HTTPS API that returns JSON.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5" onClick={() => setEditing("new")}>
          <Plus data-slot="icon" />
          Add action
        </button>
      </div>

      {actions.length > 0 ? (
        <ul className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {actions.map((a) => (
            <li key={a.id} className="nrow" style={{ alignItems: "center", cursor: "default" }}>
              <span className="faint" style={{ display: "inline-flex" }}>
                <Gi icon={Globe} />
              </span>
              <button
                type="button"
                onClick={() => setEditing(a)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate" style={{ margin: 0, fontWeight: 500 }}>{a.name}</p>
                <p className="truncate mono faint" style={{ margin: 0, fontSize: 12 }}>
                  {a.method} {a.url}
                </p>
              </button>
              {!a.enabled ? <span className="badge gray">Off</span> : null}
              <DeleteActionButton
                actionId={a.id}
                onDeleted={() => router.refresh()}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {editing !== null ? (
        <CustomActionDialog
          propertyId={propertyId}
          chatbotId={chatbotId}
          action={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function DeleteActionButton({
  actionId,
  onDeleted,
}: {
  actionId: string;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="ibtn ibtn-sm"
      aria-label="Delete action"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteCustomAction(actionId);
          if ("error" in result) toast.error(result.error);
          else onDeleted();
        })
      }
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

function CustomActionDialog({
  propertyId,
  chatbotId,
  action,
  onClose,
}: {
  propertyId: string;
  chatbotId: string;
  action: CustomActionListItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(action?.name ?? "");
  const [whenToUse, setWhenToUse] = useState(action?.when_to_use ?? "");
  const [method, setMethod] = useState<CustomActionListItem["method"]>(
    action?.method ?? "GET",
  );
  const [url, setUrl] = useState(action?.url ?? "");
  const [headers, setHeaders] = useState<HeaderDraft[]>(
    action?.headerNames.map((n) => ({ name: n, value: "", saved: true })) ?? [],
  );
  const [bodyTemplate, setBodyTemplate] = useState(action?.body_template ?? "");
  const [params, setParams] = useState<ParamField[]>(action?.param_schema ?? []);
  const [allowlist, setAllowlist] = useState(
    (action?.response_allowlist ?? []).join("\n"),
  );
  const [enabled, setEnabled] = useState(action?.enabled ?? true);
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, startSaving] = useTransition();

  const allowlistArray = allowlist
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  function draftPayload() {
    return {
      method,
      url: url.trim(),
      headers: headers
        .filter((h) => h.name.trim())
        .map((h) => ({
          name: h.name.trim(),
          // Empty value on a saved header = keep the stored secret.
          value: h.value !== "" ? h.value : h.saved ? undefined : "",
        })),
      bodyTemplate: method === "GET" ? null : bodyTemplate || null,
      params,
      responseAllowlist: allowlistArray,
    };
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const values: Record<string, string | number | boolean> = {};
      for (const p of params) {
        const raw = testValues[p.name] ?? "";
        if (raw === "") continue;
        values[p.name] =
          p.type === "number" ? Number(raw) : p.type === "boolean" ? raw === "true" : raw;
      }
      const res = await fetch(
        `/api/properties/${propertyId}/chatbots/${chatbotId}/custom-actions/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionId: action?.id,
            draft: draftPayload(),
            values,
          }),
        },
      );
      const data = await res.json();
      setTestResult(JSON.stringify(data, null, 2));
    } catch {
      setTestResult("Request failed — check the URL and try again.");
    } finally {
      setTesting(false);
    }
  }

  function save() {
    startSaving(async () => {
      const result = await saveCustomAction({
        id: action?.id,
        chatbotId,
        propertyId,
        name: name.trim(),
        whenToUse: whenToUse.trim() || undefined,
        enabled,
        ...draftPayload(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(action ? "Action updated" : "Action added");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="g8 g8-port max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{action ? "Edit custom action" : "New custom action"}</DialogTitle>
          <DialogDescription>
            The bot collects the parameters from the guest, we call your API
            server-side, and the bot answers from the response.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 1 — General */}
          <section className="space-y-3">
            <p className="text-xs font-medium text-faint-foreground">
              1 · General
            </p>
            <div className="space-y-2">
              <label className="label" htmlFor="ca-name">Name</label>
              <input className="input"
                id="ca-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Check room availability"
              />
            </div>
            <div className="space-y-2">
              <label className="label" htmlFor="ca-when">When should the bot use it?</label>
              <textarea className="textarea"
                id="ca-when"
                value={whenToUse}
                onChange={(e) => setWhenToUse(e.target.value)}
                rows={2}
                placeholder='e.g. "When the guest asks if a room is available for specific dates."'
              />
            </div>
          </section>

          {/* 2 — Request */}
          <section className="space-y-3">
            <p className="text-xs font-medium text-faint-foreground">
              2 · Request
            </p>
            <div className="flex gap-2">
              <select className="select"
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                aria-label="HTTP method"
              >
                {(["GET", "POST", "PUT", "DELETE"] as const).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                name="actionUrl"
                aria-label="Request URL"
                placeholder="https://api.example.com/availability?date={{date}}"
                className="input font-mono text-xs"
              />
            </div>
            <p className="hint">
              Use <code className="font-mono">{"{{param}}"}</code> placeholders.
              HTTPS only; on GET, unused parameters become query string.
            </p>

            <div className="space-y-2">
              <label className="label">Headers</label>
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={h.name}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...h, name: e.target.value };
                      setHeaders(next);
                    }}
                    name="headerName"
                    aria-label="Header name"
                    placeholder="Authorization"
                    className="input h-8 w-44 font-mono text-xs"
                  />
                  <input
                    value={h.value}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...h, value: e.target.value };
                      setHeaders(next);
                    }}
                    type="password"
                    name="headerValue"
                    aria-label="Header value"
                    placeholder={h.saved ? "•••••• (saved — type to replace)" : "Bearer sk-…"}
                    className="input h-8 flex-1 font-mono text-xs"
                  />
                  <button className="ibtn ibtn-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
                    aria-label="Remove header"
                    onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <button className="btn btn-secondary btn-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
                onClick={() => setHeaders([...headers, { name: "", value: "", saved: false }])}
              >
                <Plus data-slot="icon" />
                Add header
              </button>
              <p className="hint">
                Header values are encrypted at rest and never shown again.
              </p>
            </div>

            {method !== "GET" ? (
              <div className="space-y-2">
                <label htmlFor="ca-body" className="label">
                  JSON body template (optional — defaults to the parameters as JSON)
                </label>
                <textarea
                  id="ca-body"
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  rows={3}
                  placeholder={'{ "date": "{{date}}", "guests": {{guests}} }'}
                  className="textarea font-mono text-xs"
                />
              </div>
            ) : null}
          </section>

          {/* 3 — Parameters */}
          <section className="space-y-2">
            <p className="text-xs font-medium text-faint-foreground">
              3 · Parameters the bot collects
            </p>
            {params.map((p, i) => (
              <div key={p.id} className="grid grid-cols-[1fr_auto_1fr_auto_auto] items-center gap-2">
                <input
                  value={p.name}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = { ...p, name: e.target.value };
                    setParams(next);
                  }}
                  placeholder="date"
                  className="input h-8 font-mono text-xs"
                />
                <select className="select"
                  value={p.type}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = { ...p, type: e.target.value as ParamField["type"] };
                    setParams(next);
                  }}
                  aria-label="Parameter type"
                >
                  <option value="string">text</option>
                  <option value="number">number</option>
                  <option value="boolean">yes/no</option>
                </select>
                <input
                  value={p.description}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = { ...p, description: e.target.value };
                    setParams(next);
                  }}
                  placeholder="Check-in date, YYYY-MM-DD"
                  className="input h-8 text-xs"
                />
                <Chip
                  size="sm"
                  selected={p.required}
                  onClick={() => {
                    const next = [...params];
                    next[i] = { ...p, required: !p.required };
                    setParams(next);
                  }}
                >
                  required
                </Chip>
                <button className="ibtn ibtn-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
                  aria-label="Remove parameter"
                  onClick={() => setParams(params.filter((x) => x.id !== p.id))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
              onClick={() =>
                setParams([
                  ...params,
                  { id: newParamId(), name: "", type: "string", description: "", required: true },
                ])
              }
            >
              <Plus data-slot="icon" />
              Add parameter
            </button>
          </section>

          {/* 4 — Test */}
          <section className="space-y-2 rounded-lg p-3 shadow-ring">
            <p className="text-xs font-medium text-faint-foreground">
              4 · Test request
            </p>
            {params.filter((p) => p.name).length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {params
                  .filter((p) => p.name)
                  .map((p) => (
                    <input
                      key={p.id}
                      value={testValues[p.name] ?? ""}
                      onChange={(e) =>
                        setTestValues({ ...testValues, [p.name]: e.target.value })
                      }
                      placeholder={`${p.name}${p.type === "boolean" ? " (true/false)" : ""}`}
                      className="input h-8 font-mono text-xs"
                    />
                  ))}
              </div>
            ) : null}
            <button className="btn btn-secondary btn-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5" onClick={runTest} disabled={testing || !url.trim()}>
              <Play data-slot="icon" />
              {testing ? "Calling…" : "Send test request"}
            </button>
            {testResult ? (
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {testResult}
              </pre>
            ) : null}
          </section>

          {/* 5 — Data access */}
          <section className="space-y-2">
            <p className="text-xs font-medium text-faint-foreground">
              5 · Data access
            </p>
            <label htmlFor="ca-allowlist" className="label">
              Response fields the bot may see (dot paths, one per line — empty
              = full response)
            </label>
            <textarea
              id="ca-allowlist"
              value={allowlist}
              onChange={(e) => setAllowlist(e.target.value)}
              rows={3}
              placeholder={"data.available\ndata.price"}
              className="textarea font-mono text-xs"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enabled
            </label>
          </section>
        </div>

        <DialogFooter>
          <button className="btn btn-ghost [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5" onClick={save} disabled={saving || !name.trim() || !url.trim()}>
            {saving ? "Saving…" : action ? "Save action" : "Add action"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
