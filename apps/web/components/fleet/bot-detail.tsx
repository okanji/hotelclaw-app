"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { TintIcon } from "@/components/ui/tint-card";
import { AgentChat } from "@/components/agents/agent-chat";
import {
  POD_TOOL_CATALOG,
  podBotEmoji,
  type PodToolInfo,
} from "@/lib/fleet/tool-catalog";
import { CLIENT_STATUS_UI, MODEL_TIER_UI } from "@/lib/fleet/status-colors";
import { updateBot } from "./actions";
import { PageShell } from "@/components/ui/page-shell";

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
  propertySlug,
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
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <Button
          variant="ghost"
          size="icon-sm"
          render={<Link href={`/p/${propertyId}/agents/fleet`} />}
          aria-label="Back to pod bots"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <TintIcon tone="lavender" className="text-base">
          {podBotEmoji(bot.bot_id)}
        </TintIcon>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {displayName}
          </h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            @{bot.bot_id} · {client.name}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge tone={clientStatus.tone}>{clientStatus.label}</StatusBadge>
          {canEdit ? (
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
          ) : null}
        </div>
      </header>

      {paused ? (
        <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-6 py-2 text-sm text-warning">
          <ShieldAlert className="size-4 shrink-0" />
          This pod is {client.status} — its bots don&apos;t answer in channels
          or here until it&apos;s active again.
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
        <div className="flex min-h-0 flex-col gap-8 overflow-y-auto px-6 py-6">
          {!canEdit ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Only owners can change pod bot configuration — shown here so the
              whole team can see exactly what this bot can do.
            </p>
          ) : null}

          <section className="flex flex-col gap-2">
            <Eyebrow>Identity</Eyebrow>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Display name</span>
              <input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setDirty(true);
                }}
                disabled={!canEdit}
                className="h-9 w-full max-w-sm rounded-md bg-transparent px-3 text-sm outline-none focus-visible:shadow-focus disabled:opacity-60 shadow-ring"
              />
            </label>
          </section>

          <section className="flex flex-col gap-3">
            <Eyebrow>Model</Eyebrow>
            <div className="flex gap-2">
              {(["standard", "advanced"] as const).map((tier) => (
                <Chip
                  key={tier}
                  selected={modelTier === tier}
                  onClick={() => {
                    if (!canEdit) return;
                    setModelTier(tier);
                    setDirty(true);
                  }}
                >
                  {MODEL_TIER_UI[tier].label}
                </Chip>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <Eyebrow>Tools</Eyebrow>
            <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
              The bot&apos;s entire capability surface — a tool not granted
              here does not exist for it. Money-moving tools park every call
              for human approval (the Approvals inbox), no matter what the
              conversation says.
            </p>
            <div className="flex flex-col gap-4">
              {byCategory.map(([category, tools]) => (
                <fieldset key={category} className="flex flex-col gap-1.5">
                  <legend className="text-xs font-medium text-muted-foreground">
                    {category}
                  </legend>
                  {tools.map((tool) => (
                    <label
                      key={tool.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent has-[input:disabled]:cursor-default"
                    >
                      <input
                        type="checkbox"
                        checked={toolSet.has(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                        disabled={!canEdit}
                        className="mt-0.5 accent-foreground"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <code className="font-mono text-xs">{tool.id}</code>
                          {tool.gated ? (
                            <StatusBadge tone="warning" dot={false}>
                              requires approval
                            </StatusBadge>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {tool.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <Eyebrow>Fallback persona</Eyebrow>
            <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
              The bot&apos;s real persona lives in the pod&apos;s knowledge
              brain and is resolved fresh each session. This fallback applies
              only when the brain is unreachable or the playbook is unseeded —
              degradation, not the primary voice.
            </p>
            <Textarea
              value={personaFallback}
              onChange={(e) => {
                setPersonaFallback(e.target.value);
                setDirty(true);
              }}
              disabled={!canEdit}
              rows={5}
              placeholder="e.g. You are the front-desk assistant for this property…"
              className="max-w-2xl"
            />
          </section>

          <section className="flex flex-col gap-2">
            <Eyebrow>Provenance</Eyebrow>
            <dl className="grid max-w-2xl grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-xs text-muted-foreground">Persona source</dt>
              <dd className="truncate font-mono text-xs">
                playbooks/{propertySlug || "<property>"}/{bot.bot_id}.md
              </dd>
              <dt className="text-xs text-muted-foreground">Brain source</dt>
              <dd className="truncate font-mono text-xs">
                {client.brain_source || "—"}
              </dd>
              <dt className="text-xs text-muted-foreground">Chat address</dt>
              <dd className="truncate font-mono text-xs">@{bot.bot_id} in any channel</dd>
            </dl>
          </section>
        </div>

        <div className="min-h-0 border-t border-border lg:border-t-0 lg:border-l">
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
