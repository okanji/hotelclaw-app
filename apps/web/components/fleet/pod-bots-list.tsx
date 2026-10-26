"use client";

import Link from "next/link";
import { Bot, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { TintIcon } from "@/components/ui/tint-card";
import { EmptyState } from "@/components/ui/empty-state";
import { podBotEmoji, podToolInfo } from "@/lib/fleet/tool-catalog";
import { CLIENT_STATUS_UI, MODEL_TIER_UI } from "@/lib/fleet/status-colors";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/shell/page-header";

type BotRow = {
  id: string;
  bot_id: string;
  display_name: string;
  persona_fallback: string | null;
  tool_set: string[];
  model_tier: "standard" | "advanced";
};

/** Fleet index — one card per pod bot, mirroring the agents gallery. */
export function PodBotsList({
  propertyId,
  client,
  bots,
}: {
  propertyId: string;
  client: { name: string; status: "active" | "paused" | "offboarded" };
  bots: BotRow[];
}) {
  const base = `/p/${propertyId}/agents/fleet`;
  const clientStatus = CLIENT_STATUS_UI[client.status];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Agents", href: `/p/${propertyId}/agents`, icon: <Sparkles /> },
          { label: "Pod bots" },
        ]}
        meta={client.name}
        actions={<StatusBadge tone={clientStatus.tone}>{clientStatus.label}</StatusBadge>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto pt-4 pb-16">
        <PageShell width="full" className="flex flex-col">
          {bots.length === 0 ? (
            <EmptyState icon={Bot} title="No pod bots yet">
              Bots are provisioned per client during onboarding — none exist for
              this pod yet.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {bots.map((bot) => {
                const tier = MODEL_TIER_UI[bot.model_tier];
                const gatedCount = bot.tool_set.filter(
                  (id) => podToolInfo(id)?.gated,
                ).length;
                return (
                  <div
                    key={bot.id}
                    className="group relative flex flex-col gap-3 rounded-card bg-card p-4 shadow-card transition-colors hover:bg-accent"
                  >
                    <Link
                      href={`${base}/${bot.id}`}
                      className="absolute inset-0"
                      aria-label={bot.display_name}
                    />
                    <div className="flex min-w-0 items-center gap-3">
                      <TintIcon tone="lavender" className="text-base">
                        {podBotEmoji(bot.bot_id)}
                      </TintIcon>
                      <div className="min-w-0">
                        <p className="truncate text-base leading-6 font-normal">
                          {bot.display_name}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          @{bot.bot_id}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge tone={tier.tone}>{tier.label}</StatusBadge>
                      <span className="tabular-nums">
                        {bot.tool_set.length} tool{bot.tool_set.length === 1 ? "" : "s"}
                      </span>
                      {gatedCount > 0 ? (
                        <span className="tabular-nums text-warning">
                          {gatedCount} approval-gated
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </PageShell>
      </div>
    </div>
  );
}
