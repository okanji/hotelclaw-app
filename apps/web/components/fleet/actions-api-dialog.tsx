"use client";

import { useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
    <div className="flex flex-col gap-5 rounded-lg border border-border p-4">
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Endpoint
        </h3>
        <button
          type="button"
          onClick={() => copy(endpoint, "Endpoint URL")}
          className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left font-mono text-xs text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title="Copy"
        >
          <span className="truncate">{endpoint}</span>
          <Copy className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
        <p className="text-xs text-muted-foreground">
          Streamable HTTP MCP. Send the key as{" "}
          <code className="font-mono">Authorization: Bearer hc_…</code> — each
          key can call only the tools granted below, and money-moving steps
          inside workflows still park for human approval.
        </p>
      </section>

      {freshToken ? (
        <section className="flex flex-col gap-1.5 rounded-md border border-success/40 bg-success/5 p-3">
          <p className="text-xs font-medium text-foreground">
            Key created — copy it now, it won&apos;t be shown again.
          </p>
          <button
            type="button"
            onClick={() => copy(freshToken, "Key")}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left font-mono text-xs text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="truncate">{freshToken}</span>
            <Copy className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Keys
        </h3>
        {actionKeys.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border/40">
            {actionKeys.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm text-foreground">
                    {t.name}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {(t.allowed_tools ?? []).map((tool) => (
                      <span
                        key={tool}
                        className="rounded-full border border-border/60 px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                      >
                        {tool}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t.last_used_at
                    ? `used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : "never used"}
                </span>
                <button
                  type="button"
                  aria-label={`Revoke ${t.name}`}
                  onClick={() => void revoke(t.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No action keys.</p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap gap-1.5">
            {ACTIONS_MCP_TOOLS.map((tool) => (
              <Chip
                key={tool}
                size="sm"
                selected={grants.has(tool)}
                onClick={() => toggleGrant(tool)}
                title={ACTIONS_MCP_TOOL_INFO[tool].description}
              >
                {tool}
                {ACTIONS_MCP_TOOL_INFO[tool].write ? " ✎" : ""}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={name}
              name="keyName"
              aria-label="Key name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name (e.g. Zapier)"
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={creating || name.trim().length === 0 || grants.size === 0}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Create
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
