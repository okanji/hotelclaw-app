"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, ShieldAlert, Sparkles } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Badge } from "@/components/gr8r/ai-glyphs";
import { AgentChat } from "@/components/agents/agent-chat";
import {
  POD_TOOL_CATALOG,
  podBotEmoji,
  type PodToolInfo,
} from "@/lib/fleet/tool-catalog";
import { CLIENT_STATUS_UI, MODEL_TIER_UI } from "@/lib/fleet/status-colors";
import { updateBot } from "./actions";
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

/**
 * Pod-bot workspace (agent-detail layout): config + transparency on the
 * left, a live test chat on the right — the chat drives the REAL pod bot
 * through eve (cookie auth + x-hotelclaw-bot), so what you test is exactly
 * what the team gets in channels. Owners edit; everyone else reads.
 */
export function BotDetail({
  propertyId,
  client,
  bot,
  canEdit,
}: {
  propertyId: string;
  propertySlug: string;
  client: {
    name: string;
    status: "active" | "paused" | "offboarded";
    brain_source: string;
  };
  bot: BotRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(bot.display_name);
  const [personaFallback, setPersonaFallback] = useState(
    bot.persona_fallback ?? "",
  );
  const [toolSet, setToolSet] = useState<Set<string>>(
    () => new Set(bot.tool_set),
  );
  const [modelTier, setModelTier] = useState(bot.model_tier);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();

  const clientStatus = CLIENT_STATUS_UI[client.status];
  const paused = client.status !== "active";

  const byCategory = useMemo(() => {
    const groups = new Map<string, PodToolInfo[]>();
    for (const tool of POD_TOOL_CATALOG) {
      const list = groups.get(tool.category) ?? [];
      list.push(tool);
      groups.set(tool.category, list);
    }
    return [...groups.entries()];
  }, []);

  function toggleTool(id: string) {
    if (!canEdit) return;
    setToolSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  }

  function save() {
    startSaving(async () => {
      const result = await updateBot({
        propertyId,
        botId: bot.id,
        patch: {
          display_name: displayName,
          persona_fallback: personaFallback.trim() || null,
          tool_set: [...toolSet],
          model_tier: modelTier,
        },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setDirty(false);
      toast.success("Bot saved — the next session uses the new config");
      router.refresh();
    });
  }

  return (
    // Two-pane workspace (config beside the live test chat) — a canvas
    // surface: header bar and both panes share the full pane width.
    <PageShell width="bleed" className="flex h-full min-h-0 flex-col">
      <PageHeader
        className="border-b border-border"
        breadcrumbs={[
          {
            label: "Agents",
            href: `/p/${propertyId}/agents`,
            icon: <Sparkles />,
          },
          { label: "Pod bots", href: `/p/${propertyId}/agents/fleet` },
          { label: `${podBotEmoji(bot.bot_id)} ${displayName}` },
        ]}
        meta={<span className="font-mono text-xs">@{bot.bot_id}</span>}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <G8Badge tone={clientStatus.tone}>{clientStatus.label}</G8Badge>
            {canEdit ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </button>
            ) : null}
          </div>
        }
      />

      {paused ? (
        <div className="alert warn" style={{ borderRadius: 0, borderInline: 0, borderTop: 0 }}>
          <Gi icon={ShieldAlert} size={15} />
          <div>
            This pod is {client.status} — its bots don&apos;t answer in channels
            or here until it&apos;s active again.
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
        <div className="flex min-h-0 flex-col overflow-y-auto" style={{ padding: "24px var(--g8-gutter) 48px" }}>
          <div style={{ maxWidth: 720 }}>
          {!canEdit ? (
            <div className="alert info" style={{ marginBottom: 8 }}>
              <Gi icon={Lock} size={15} />
              <div>
                Only owners can change pod bot configuration — shown here so the
                whole team can see exactly what this bot can do.
              </div>
            </div>
          ) : null}

          <section className="sblock" style={{ marginTop: canEdit ? 0 : undefined }}>
            <h2>Identity</h2>
            <div className="field" style={{ marginTop: 10, maxWidth: 380 }}>
              <label className="label" htmlFor="pod-bot-name">Display name</label>
              <input
                id="pod-bot-name"
                className="input"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setDirty(true);
                }}
                disabled={!canEdit}
              />
            </div>
          </section>

          <section className="sblock">
            <h2>Model</h2>
            <div className="seg" style={{ marginTop: 10 }} role="radiogroup" aria-label="Model">
              {(["standard", "advanced"] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  role="radio"
                  aria-checked={modelTier === tier}
                  className={modelTier === tier ? "on" : undefined}
                  disabled={!canEdit}
                  onClick={() => {
                    if (!canEdit) return;
                    setModelTier(tier);
                    setDirty(true);
                  }}
                >
                  {MODEL_TIER_UI[tier].label}
                </button>
              ))}
            </div>
          </section>

          <section className="sblock">
            <h2>Tools</h2>
            <p className="muted" style={{ margin: "8px 0 10px", fontSize: "var(--g8-fs-sm)", maxWidth: 640 }}>
              The bot&apos;s entire capability surface — a tool not granted
              here does not exist for it. Money-moving tools park every call
              for human approval (the Approvals inbox), no matter what the
              conversation says.
            </p>
            <div className="flex flex-col gap-4">
              {byCategory.map(([category, tools]) => (
                <fieldset key={category} className="flex flex-col" style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className="eyebrow" style={{ marginBottom: 4 }}>
                    {category}
                  </legend>
                  {tools.map((tool) => (
                    <label
                      key={tool.id}
                      className="srow"
                      style={{ padding: "8px 0", cursor: canEdit ? "pointer" : "default" }}
                    >
                      <span className="min-w-0">
                        <span className="t row" style={{ gap: 8 }}>
                          <code className="mono" style={{ fontSize: "var(--g8-fs-xs)" }}>{tool.id}</code>
                          {tool.gated ? (
                            <G8Badge tone="warning" dot={false}>
                              requires approval
                            </G8Badge>
                          ) : null}
                        </span>
                        <span className="d" style={{ display: "block" }}>
                          {tool.description}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        className="toggle"
                        checked={toolSet.has(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                        disabled={!canEdit}
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </section>

          <section className="sblock">
            <h2>Fallback persona</h2>
            <p className="muted" style={{ margin: "8px 0 10px", fontSize: "var(--g8-fs-sm)", maxWidth: 640 }}>
              The persona the bot runs with. It is resolved fresh each session,
              and property memory (Agents → Memory) is recalled on top of it
              every turn — put standing facts there, not in the persona.
            </p>
            <textarea
              className="textarea"
              value={personaFallback}
              onChange={(e) => {
                setPersonaFallback(e.target.value);
                setDirty(true);
              }}
              disabled={!canEdit}
              rows={5}
              placeholder="e.g. You are the front-desk assistant for this property…"
            />
          </section>

          <section className="sblock">
            <h2>Provenance</h2>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Persona source</dt>
              <dd>the persona configured above (bots.persona_fallback)</dd>
              <dt>Memory</dt>
              <dd>property memory, recalled every turn — browse it under Agents → Memory</dd>
              <dt>Chat address</dt>
              <dd className="mono trunc">@{bot.bot_id} in any channel</dd>
            </dl>
          </section>
          </div>
        </div>

        <div className="min-h-0 border-t lg:border-t-0 lg:border-l" style={{ borderColor: "var(--g8-border)", background: "var(--g8-surface)" }}>
          <AgentChat
            propertyId={propertyId}
            target={{ botSlug: bot.bot_id }}
            agentName={displayName}
            avatarEmoji={podBotEmoji(bot.bot_id)}
            starterPrompts={[
              "What can you help with?",
              "List your tools.",
            ]}
            paused={paused}
            initialSession={null}
          />
        </div>
      </div>
    </PageShell>
  );
}
