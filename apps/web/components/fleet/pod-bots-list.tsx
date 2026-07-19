"use client";

import Link from "next/link";
import { Bot } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { TintIcon } from "@/components/ui/tint-card";
import { EmptyState } from "@/components/ui/empty-state";
import { podBotEmoji, podToolInfo } from "@/lib/fleet/tool-catalog";
import { CLIENT_STATUS_UI, MODEL_TIER_UI } from "@/lib/fleet/status-colors";

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
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        className="flex-wrap gap-y-3"
        eyebrow="Fleet"
        eyebrowTone="brand"
        title="Pod bots"
        description={`The operated AI bots serving ${client.name}. Each bot's persona lives in the pod's knowledge brain; its tools, model, and fallback persona are configured here — and every grant is visible to the whole team.`}
        actions={<StatusBadge tone={clientStatus.tone}>{clientStatus.label}</StatusBadge>}
      />

      <hr className="my-10 border-border" />

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
                className="group relative flex flex-col gap-3 rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/40"
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
                    <p className="truncate text-sm font-medium">
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
    </div>
  );
}
