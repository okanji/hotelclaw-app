"use client";

import Link from "next/link";
import { Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BRAIN_HEALTH_UI, CLIENT_STATUS_UI } from "@/lib/fleet/status-colors";
import { ActionsApiKeys } from "./actions-api-dialog";

/**
 * Brain & access — read-only transparency for the pod's knowledge brain
 * (ONE shared gbrain server; this pod's OAuth client is bound server-side
 * to its own source, which IS the tenancy wall) + the Actions API key
 * manager for external automations.
 */
export function BrainView({
  propertyId,
  client,
  health,
  configured,
  isOwner,
}: {
  propertyId: string;
  client: {
    name: string;
    status: "active" | "paused" | "offboarded";
    brain_source: string;
    brain_client_secret_ref: string;
  };
  health: { status?: string; version?: string; engine?: string } | null;
  configured: boolean;
  isOwner: boolean;
}) {
  const healthUi = !configured
    ? BRAIN_HEALTH_UI.unconfigured
    : health?.status === "ok"
      ? BRAIN_HEALTH_UI.ok
      : BRAIN_HEALTH_UI.unreachable;
  const clientStatus = CLIENT_STATUS_UI[client.status];

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        eyebrow="Fleet"
        eyebrowTone="brand"
        title="Brain & access"
        description="Where the pod's knowledge lives and who can reach this property from outside. Secrets never appear here — only what they're called."
        actions={
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/p/${propertyId}/agents/brain`} />}
          >
            <Library data-icon="inline-start" />
            Browse the brain
          </Button>
        }
      />

      <hr className="my-10 border-border" />

      <section className="flex flex-col gap-4">
        <Eyebrow>Knowledge brain</Eyebrow>
        <div className="flex flex-col gap-3 rounded-lg p-4 shadow-ring">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={healthUi.tone}>{healthUi.label}</StatusBadge>
            {health?.engine ? (
              <span className="text-xs text-muted-foreground">
                engine <code className="font-mono">{health.engine}</code>
              </span>
            ) : null}
            {health?.version ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                v{health.version}
              </span>
            ) : null}
            <span className="ml-auto">
              <StatusBadge tone={clientStatus.tone}>
                Pod {clientStatus.label.toLowerCase()}
              </StatusBadge>
            </span>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-xs text-muted-foreground">Write source</dt>
            <dd className="truncate font-mono text-xs">
              {client.brain_source || "—"}
            </dd>
            <dt className="text-xs text-muted-foreground">Credential ref</dt>
            <dd className="truncate font-mono text-xs">
              {client.brain_client_secret_ref || "—"}
              <span className="ml-2 font-sans text-muted-foreground">
                (env var name — the secret itself never leaves the server)
              </span>
            </dd>
          </dl>
          <p className="max-w-2xl text-xs text-pretty text-muted-foreground">
            One shared brain server hosts every pod. Isolation is structural:
            this pod&apos;s OAuth client can write only to its own source
            (<code className="font-mono">{client.brain_source || "…"}</code>)
            and read only its allow-listed sources — the master playbooks are
            shared read-only, other pods&apos; knowledge is invisible. Bots
            resolve their persona and answers through this binding on every
            session.
          </p>
        </div>
      </section>

      <section className="mt-12 flex flex-col gap-4">
        <Eyebrow>Actions API</Eyebrow>
        {isOwner ? (
          <ActionsApiKeys propertyId={propertyId} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Only owners manage API keys.
          </p>
        )}
      </section>
    </div>
  );
}
