"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";

/**
 * API access — property-scoped tokens for the MCP endpoint, so external AI
 * clients (Claude, ChatGPT) can query this property's deterministic numbers.
 * Plaintext is shown exactly once at creation; the list shows metadata only.
 * Owner only.
 */

type TokenRow = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function tokensQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["api-tokens", propertyId] as const,
    queryFn: async (): Promise<TokenRow[]> => {
      const res = await fetch(`/api/properties/${propertyId}/api-tokens`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load tokens");
      const body = (await res.json()) as { tokens: TokenRow[] };
      return body.tokens;
    },
  });
}

export function ApiAccessButton({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        title="API access for external AI clients"
      >
        <KeyRound className="size-4" />
      </Button>
      <ApiAccessDialog
        propertyId={propertyId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function ApiAccessDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: tokens = [] } = useQuery({
    ...tokensQueryOptions(propertyId),
    enabled: open,
  });
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp/mcp`
      : "/api/mcp/mcp";

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["api-tokens", propertyId] });

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/api-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error("Couldn't create the token");
      const body = (await res.json()) as { token: string };
      setFreshToken(body.token);
      setName("");
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the token");
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

  const active = tokens.filter((t) => !t.revoked_at);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            API access
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Connect Claude, ChatGPT, or scripts to this property&apos;s live
            numbers over MCP — the same deterministic metrics the dashboards
            chart. Tokens are read-only and scoped to this property.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <Eyebrow>Endpoint</Eyebrow>
            <button
              type="button"
              onClick={() => copy(mcpUrl, "Endpoint URL")}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-left font-mono text-xs text-foreground transition-colors outline-none hover:bg-accent-pressed focus-visible:shadow-focus"
              title="Copy"
            >
              <span className="truncate">{mcpUrl}</span>
              <Copy className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
            <p className="text-sm text-muted-foreground">
              Streamable HTTP transport. Send the token as{" "}
              <code className="font-mono">Authorization: Bearer hc_…</code>
            </p>
          </section>

          {freshToken ? (
            <section className="flex flex-col gap-2 rounded-md bg-success/10 p-3">
              <p className="text-sm font-medium text-foreground">
                Token created — copy it now, it won&apos;t be shown again.
              </p>
              <button
                type="button"
                onClick={() => copy(freshToken, "Token")}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md bg-card px-3 py-2 text-left font-mono text-xs text-foreground transition-colors outline-none hover:bg-accent focus-visible:shadow-focus"
              >
                <span className="truncate">{freshToken}</span>
                <Copy className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <Eyebrow>Tokens</Eyebrow>
            {active.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {active.map((t) => (
                  <li key={t.id} className="flex min-h-[37px] items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {t.name}
                    </span>
                    <span className="shrink-0 text-xs text-faint-foreground tabular-nums">
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
              <p className="text-sm text-muted-foreground">
                No active tokens.
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
              className="flex items-center gap-2"
            >
              <Input
                value={name}
                name="tokenName"
                aria-label="Token name"
                onChange={(e) => setName(e.target.value)}
                placeholder="Token name (e.g. Claude Desktop)"
                className="flex-1"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={creating || name.trim().length === 0}
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Create
              </Button>
            </form>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
