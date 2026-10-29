"use client";

import Link from "next/link";
import { Bot, Sparkles } from "lucide-react";
import { G8Badge } from "@/components/gr8r/ai-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
import { podBotEmoji, podToolInfo } from "@/lib/fleet/tool-catalog";
import { CLIENT_STATUS_UI, MODEL_TIER_UI } from "@/lib/fleet/status-colors";
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
        actions={<G8Badge tone={clientStatus.tone}>{clientStatus.label}</G8Badge>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide" style={{ maxWidth: 1200 }}>
          <div className="ph">
            <div>
              <h1>Pod bots</h1>
              <p>
                {client.name} · {bots.length} bot{bots.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          {bots.length === 0 ? (
            <div className="panel">
              <G8Empty
                icon={Bot}
                title="No pod bots yet"
                text="Bots are provisioned per client during onboarding — none exist for this pod yet."
              />
            </div>
          ) : (
            <div className="pgrid">
              {bots.map((bot) => {
                const tier = MODEL_TIER_UI[bot.model_tier];
                const gatedCount = bot.tool_set.filter(
                  (id) => podToolInfo(id)?.gated,
                ).length;
                return (
                  <div key={bot.id} className="pcard">
                    <Link
                      href={`${base}/${bot.id}`}
                      className="absolute inset-0"
                      aria-label={bot.display_name}
                    />
                    <div className="row" style={{ gap: 10 }}>
                      <span className="picon" style={{ "--g8-c": "var(--g8-violet)", fontSize: 15 } as React.CSSProperties}>
                        {podBotEmoji(bot.bot_id)}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <b className="trunc" style={{ display: "block", fontWeight: 600 }}>
                          {bot.display_name}
                        </b>
                        <span className="mono faint trunc" style={{ display: "block", fontSize: "var(--g8-fs-xs)" }}>
                          @{bot.bot_id}
                        </span>
                      </div>
                    </div>
                    <div className="foot">
                      <G8Badge tone={tier.tone}>{tier.label}</G8Badge>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {bot.tool_set.length} tool{bot.tool_set.length === 1 ? "" : "s"}
                      </span>
                      {gatedCount > 0 ? (
                        <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--g8-amber)" }}>
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
      </div>
    </div>
  );
}
