"use client";

import { useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Gi } from "@/components/gr8r/icon";
import {
  ACTIONS_MCP_TOOLS,
  ACTIONS_MCP_TOOL_INFO,
  type ActionsMcpTool,
} from "@/lib/mcp/actions-tools";

/**
 * Actions API keys — write-capable, per-tool-scoped keys for the
 * /api/actions-mcp endpoint (external automations: trigger workflows,
 * create tasks). Same api_tokens table as the read-only insights keys; the
 * allowed_tools grant is what separates the two. Plaintext shows once.
 * Inline panel (not a dialog) — it lives on the Brain & access page.
 */

type TokenRow = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  allowed_tools: string[] | null;
};

function tokensQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["api-tokens", propertyId] as const,
    queryFn: async (): Promise<TokenRow[]> => {
      const res = await fetch(`/api/properties/${propertyId}/api-tokens`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load keys");
      const body = (await res.json()) as { tokens: TokenRow[] };
      return body.tokens;
    },
  });
}

export function ActionsApiKeys({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { data: tokens = [] } = useQuery(tokensQueryOptions(propertyId));
  const [name, setName] = useState("");
  const [grants, setGrants] = useState<Set<ActionsMcpTool>>(new Set());
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const endpoint =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/actions-mcp/mcp`
      : "/api/actions-mcp/mcp";

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["api-tokens", propertyId] });

  function toggleGrant(tool: ActionsMcpTool) {
    setGrants((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });
  }

  async function create() {
    if (!name.trim() || grants.size === 0) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/api-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), allowed_tools: [...grants] }),
      });
      if (!res.ok) throw new Error("Couldn't create the key");
      const body = (await res.json()) as { token: string };
      setFreshToken(body.token);
      setName("");
      setGrants(new Set());
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the key");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(tokenId: string) {
    const res = await fetch(
      `/api/properties/${propertyId}/api-tokens/${tokenId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error("Couldn't revoke");
      return;
    }
    await invalidate();
  }

  function copy(text: string, what: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error("Couldn't copy"),
    );
  }

  // Keys with action grants belong here; grant-less keys are the insights
  // (read-only) credentials managed from the Insights header.
  const actionKeys = tokens.filter(
    (t) => !t.revoked_at && (t.allowed_tools?.length ?? 0) > 0,
  );

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-h">
          <h2>Endpoint</h2>
        </div>
        <div className="panel-b">
          <button
            type="button"
            onClick={() => copy(endpoint, "Endpoint URL")}
            className="input mono row"
            style={{ width: "100%", justifyContent: "space-between", cursor: "pointer", fontSize: "var(--g8-fs-xs)" }}
            title="Copy"
          >
            <span className="trunc">{endpoint}</span>
            <Gi icon={Copy} size={13} />
          </button>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: "var(--g8-fs-xs)" }}>
            Streamable HTTP MCP. Send the key as{" "}
            <code className="mono">Authorization: Bearer hc_…</code> — each
            key can call only the tools granted below, and money-moving steps
            inside workflows still park for human approval.
          </p>
        </div>
      </section>

      {freshToken ? (
        <div className="alert ok">
          <Gi icon={KeyRound} size={15} />
          <div className="grow" style={{ minWidth: 0 }}>
            <b>Key created — copy it now, it won&apos;t be shown again.</b>
            <button
              type="button"
              onClick={() => copy(freshToken, "Key")}
              className="input mono row"
              style={{ width: "100%", marginTop: 6, justifyContent: "space-between", cursor: "pointer", fontSize: "var(--g8-fs-xs)" }}
            >
              <span className="trunc">{freshToken}</span>
              <Gi icon={Copy} size={13} />
            </button>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-h">
          <h2>Keys</h2>
          <span className="faint" style={{ fontSize: "var(--g8-fs-xs)" }}>{actionKeys.length}</span>
        </div>
        {actionKeys.length > 0 ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {actionKeys.map((t) => (
              <li key={t.id} className="mini" style={{ cursor: "default", padding: "8px 14px", alignItems: "flex-start" }}>
                <span className="grow col" style={{ minWidth: 0, gap: 4 }}>
                  <span className="trunc" style={{ fontWeight: 500 }}>{t.name}</span>
                  <span className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                    {(t.allowed_tools ?? []).map((tool) => (
                      <span key={tool} className="badge mono">
                        {tool}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="due">
                  {t.last_used_at
                    ? `used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : "never used"}
                </span>
                <button
                  type="button"
                  aria-label={`Revoke ${t.name}`}
                  onClick={() => void revoke(t.id)}
                  className="ibtn ibtn-xs"
                >
                  <Gi icon={Trash2} size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted panel-b" style={{ margin: 0, fontSize: "var(--g8-fs-sm)" }}>No action keys.</p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="panel-b flex flex-col gap-3"
          style={{ borderTop: "1px solid var(--g8-divider)", paddingTop: 14 }}
        >
          <div className="label">New key — grant tools</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {ACTIONS_MCP_TOOLS.map((tool) => {
              const on = grants.has(tool);
              return (
                <button
                  key={tool}
                  type="button"
                  aria-pressed={on}
                  className={on ? "chip mono" : "btn btn-secondary btn-sm mono"}
                  style={on ? { padding: "0 8px" } : undefined}
                  onClick={() => toggleGrant(tool)}
                  title={ACTIONS_MCP_TOOL_INFO[tool].description}
                >
                  {tool}
                  {ACTIONS_MCP_TOOL_INFO[tool].write ? " ✎" : ""}
                </button>
              );
            })}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={name}
              name="keyName"
              aria-label="Key name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name (e.g. Zapier)"
              className="input grow"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating || name.trim().length === 0 || grants.size === 0}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Gi icon={Plus} size={14} />
              )}
              Create
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
