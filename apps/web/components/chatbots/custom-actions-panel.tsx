"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Globe, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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

const selectClass =
  "h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

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
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Custom API actions</p>
          <p className="text-xs text-muted-foreground">
            Connect the bot to your own systems — a booking engine, PMS, or
            any HTTPS API that returns JSON.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus data-slot="icon" />
          Add action
        </Button>
      </div>

      {actions.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {actions.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => setEditing(a)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm">{a.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {a.method} {a.url}
                </p>
              </button>
              {!a.enabled ? <Badge variant="secondary">Off</Badge> : null}
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
    <Button
      variant="ghost"
      size="icon-sm"
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
    </Button>
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
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
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              1 · General
            </p>
            <div className="space-y-2">
              <Label htmlFor="ca-name">Name</Label>
              <Input
                id="ca-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Check room availability"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ca-when">When should the bot use it?</Label>
              <Textarea
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
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              2 · Request
            </p>
            <div className="flex gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className={cn(selectClass, "w-28 shrink-0")}
                aria-label="HTTP method"
              >
                {(["GET", "POST", "PUT", "DELETE"] as const).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/availability?date={{date}}"
                className="font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Use <code className="font-mono">{"{{param}}"}</code> placeholders.
              HTTPS only; on GET, unused parameters become query string.
            </p>

            <div className="space-y-2">
              <Label className="text-xs">Headers</Label>
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={h.name}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...h, name: e.target.value };
                      setHeaders(next);
                    }}
                    placeholder="Authorization"
                    className="h-8 w-44 font-mono text-xs"
                  />
                  <Input
                    value={h.value}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...h, value: e.target.value };
                      setHeaders(next);
                    }}
                    type="password"
                    placeholder={h.saved ? "•••••• (saved — type to replace)" : "Bearer sk-…"}
                    className="h-8 flex-1 font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove header"
                    onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHeaders([...headers, { name: "", value: "", saved: false }])}
              >
                <Plus data-slot="icon" />
                Add header
              </Button>
              <p className="text-xs text-muted-foreground">
                Header values are encrypted at rest and never shown again.
              </p>
            </div>

            {method !== "GET" ? (
              <div className="space-y-2">
                <Label htmlFor="ca-body" className="text-xs">
                  JSON body template (optional — defaults to the parameters as JSON)
                </Label>
                <Textarea
                  id="ca-body"
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  rows={3}
                  placeholder={'{ "date": "{{date}}", "guests": {{guests}} }'}
                  className="font-mono text-xs"
                />
              </div>
            ) : null}
          </section>

          {/* 3 — Parameters */}
          <section className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              3 · Parameters the bot collects
            </p>
            {params.map((p, i) => (
              <div key={p.id} className="grid grid-cols-[1fr_auto_1fr_auto_auto] items-center gap-2">
                <Input
                  value={p.name}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = { ...p, name: e.target.value };
                    setParams(next);
                  }}
                  placeholder="date"
                  className="h-8 font-mono text-xs"
                />
                <select
                  value={p.type}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = { ...p, type: e.target.value as ParamField["type"] };
                    setParams(next);
                  }}
                  className={cn(selectClass, "h-8 text-xs")}
                  aria-label="Parameter type"
                >
                  <option value="string">text</option>
                  <option value="number">number</option>
                  <option value="boolean">yes/no</option>
                </select>
                <Input
                  value={p.description}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = { ...p, description: e.target.value };
                    setParams(next);
                  }}
                  placeholder="Check-in date, YYYY-MM-DD"
                  className="h-8 text-xs"
                />
                <button
                  type="button"
                  aria-pressed={p.required}
                  onClick={() => {
                    const next = [...params];
                    next[i] = { ...p, required: !p.required };
                    setParams(next);
                  }}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs",
                    p.required
                      ? "border-foreground/40 text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  required
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove parameter"
                  onClick={() => setParams(params.filter((x) => x.id !== p.id))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setParams([
                  ...params,
                  { id: newParamId(), name: "", type: "string", description: "", required: true },
                ])
              }
            >
              <Plus data-slot="icon" />
              Add parameter
            </Button>
          </section>

          {/* 4 — Test */}
          <section className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              4 · Test request
            </p>
            {params.filter((p) => p.name).length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {params
                  .filter((p) => p.name)
                  .map((p) => (
                    <Input
                      key={p.id}
                      value={testValues[p.name] ?? ""}
                      onChange={(e) =>
                        setTestValues({ ...testValues, [p.name]: e.target.value })
                      }
                      placeholder={`${p.name}${p.type === "boolean" ? " (true/false)" : ""}`}
                      className="h-8 font-mono text-xs"
                    />
                  ))}
              </div>
            ) : null}
            <Button variant="outline" size="sm" onClick={runTest} disabled={testing || !url.trim()}>
              <Play data-slot="icon" />
              {testing ? "Calling…" : "Send test request"}
            </Button>
            {testResult ? (
              <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {testResult}
              </pre>
            ) : null}
          </section>

          {/* 5 — Data access */}
          <section className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              5 · Data access
            </p>
            <Label htmlFor="ca-allowlist" className="text-xs">
              Response fields the bot may see (dot paths, one per line — empty
              = full response)
            </Label>
            <Textarea
              id="ca-allowlist"
              value={allowlist}
              onChange={(e) => setAllowlist(e.target.value)}
              rows={3}
              placeholder={"data.available\ndata.price"}
              className="font-mono text-xs"
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
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim() || !url.trim()}>
            {saving ? "Saving…" : action ? "Save action" : "Add action"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
