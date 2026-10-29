"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  Bot,
  BookOpen,
  Copy,
  MessagesSquare,
  Puzzle,
  Settings2,
  Share2,
  Wand2,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import {
  parseChatbotConfig,
  type ChatbotConfig,
  type ChatbotRow,
} from "@/lib/chatbots/schema";
import { ChatbotStatusBadge } from "./chatbots-list";
import { ActionsPanel } from "./actions-panel";
import {
  CustomActionsPanel,
  type CustomActionListItem,
} from "./custom-actions-panel";
import {
  KnowledgePanel,
  type DocumentOption,
  type KnowledgeSourceRow,
} from "./knowledge-panel";
import { TestConsole } from "./test-console";
import { ConversationsTab, type ConversationListRow } from "./conversations-list";
import { AnalyticsTab } from "./analytics-tab";
import { DeployPanel } from "./deploy-panel";
import { updateChatbot } from "./actions";

export type ChannelOption = { id: string; name: string; stream_channel_id: string };
export type SpaceOption = { id: string; name: string };

/**
 * Chatbot builder — tabbed editor on the left, always-on test console on
 * the right (the converged agent-builder layout). Config edits are local
 * until Save; status and caps write through immediately (forms pattern).
 */
export function ChatbotDetail({
  propertyId,
  bot,
  sources,
  channels,
  spaces,
  conversations,
  documents,
  customActions,
  deployedChannelIds,
}: {
  propertyId: string;
  bot: ChatbotRow;
  sources: KnowledgeSourceRow[];
  channels: ChannelOption[];
  spaces: SpaceOption[];
  conversations: ConversationListRow[];
  documents: DocumentOption[];
  customActions: CustomActionListItem[];
  deployedChannelIds: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<
    | "build"
    | "knowledge"
    | "skills"
    | "conversations"
    | "analytics"
    | "share"
    | "settings"
  >("build");
  const [name, setName] = useState(bot.name);
  const [status, setStatus] = useState(bot.status);
  const [config, setConfig] = useState<ChatbotConfig>(() =>
    parseChatbotConfig(bot.config),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();
  const [savingStatus, startStatusTransition] = useTransition();

  function updateConfig(patch: Partial<ChatbotConfig>) {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
  }

  // Capabilities count for the Skills tab badge: enabled built-in actions +
  // enabled custom HTTP actions (each is a tool the bot can call). Both sides
  // filter on `enabled` so a disabled custom action doesn't inflate the badge.
  // Reads live config so toggles reflect immediately.
  const skillCount =
    config.actions.filter((a) => a.enabled).length +
    customActions.filter((a) => a.enabled).length;

  function save() {
    startSave(async () => {
      const result = await updateChatbot({ chatbotId: bot.id, patch: { config } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setDirty(false);
      toast.success("Chatbot saved");
      router.refresh();
    });
  }

  function saveName() {
    const next = name.trim();
    if (!next || next === bot.name) {
      setName(bot.name);
      return;
    }
    void updateChatbot({ chatbotId: bot.id, patch: { name: next } }).then((result) => {
      if ("error" in result) {
        toast.error(result.error);
        setName(bot.name);
      } else {
        router.refresh();
      }
    });
  }

  function setBotStatus(next: ChatbotRow["status"]) {
    startStatusTransition(async () => {
      // Persist any unsaved config edits with the publish — publishing a
      // stale draft config is the surprising behavior, not the save.
      const result = await updateChatbot({
        chatbotId: bot.id,
        patch: dirty ? { status: next, config } : { status: next },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStatus(next);
      setDirty(false);
      toast.success(
        next === "published"
          ? "Chatbot is live — share the guest link"
          : next === "paused"
            ? "Chatbot paused — the guest page shows it as unavailable"
            : "Chatbot moved back to draft",
      );
      router.refresh();
    });
  }

  function copyGuestLink() {
    void navigator.clipboard
      .writeText(`${window.location.origin}/g/${bot.public_slug}`)
      .then(() => toast.success("Guest link copied"));
  }

  const TABS: { value: typeof tab; icon: typeof Wand2; label: string; count?: number }[] = [
    { value: "build", icon: Wand2, label: "Build" },
    { value: "knowledge", icon: BookOpen, label: "Knowledge", count: sources.length },
    { value: "skills", icon: Puzzle, label: "Skills", count: skillCount },
    {
      value: "conversations",
      icon: MessagesSquare,
      label: "Conversations",
      count: conversations.length,
    },
    { value: "analytics", icon: BarChart3, label: "Analytics" },
    { value: "share", icon: Share2, label: "Share" },
    { value: "settings", icon: Settings2, label: "Settings" },
  ];

  return (
    // `.page wide`, like the other two-pane workspaces: the builder column
    // sits beside a 380px sticky test console, so a capped page left the
    // 7-tab strip clipped. One left edge for header, tabs, builder, console.
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Chatbots", icon: <Bot />, href: `/p/${propertyId}/chatbots` },
          { label: name || "Untitled chatbot" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          <div className="ph" style={{ alignItems: "center" }}>
            <span className="picon lg" style={{ "--g8-c": "var(--g8-violet)" } as CSSProperties}>
              {config.appearance.avatarEmoji ? (
                <span style={{ fontSize: 17, lineHeight: 1 }}>{config.appearance.avatarEmoji}</span>
              ) : (
                <Gi icon={Bot} size={17} />
              )}
            </span>
            <div style={{ minWidth: 0 }}>
              <h1>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setName(bot.name);
                  }}
                  aria-label="Chatbot name"
                  className="ph-name-in field-sizing-content"
                  placeholder="Untitled chatbot"
                />
              </h1>
              <p className="row" style={{ gap: 8 }}>
                <ChatbotStatusBadge status={status} />
                <span className="mono faint" style={{ fontSize: 12 }}>
                  /g/{bot.public_slug}
                </span>
              </p>
            </div>
            <div className="acts">
              <button type="button" className="btn btn-secondary" onClick={copyGuestLink}>
                <Gi icon={Copy} size={14} />
                <span className="max-sm:hidden">Guest link</span>
              </button>
              {dirty ? (
                <button type="button" className="btn btn-secondary" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
              ) : null}
              {status !== "published" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setBotStatus("published")}
                  disabled={savingStatus}
                >
                  Publish
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setBotStatus("paused")}
                  disabled={savingStatus}
                >
                  Pause
                </button>
              )}
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
            <div className="flex min-w-0 flex-col">
              <div className="tabs" role="tablist" aria-label="Chatbot editor">
                {TABS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.value}
                    className={tab === t.value ? "tab on" : "tab"}
                    onClick={() => setTab(t.value)}
                  >
                    <Gi icon={t.icon} size={14} />
                    {t.label}
                    {typeof t.count === "number" && t.count > 0 ? (
                      <span className="cnt num">{t.count}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              <div role="tabpanel" className="stack" style={{ marginTop: 20, gap: 24 }}>
                {tab === "build" ? (
                  <BuildSection config={config} onChange={updateConfig} />
                ) : null}

                {tab === "knowledge" ? (
                  <KnowledgePanel
                    propertyId={propertyId}
                    chatbotId={bot.id}
                    sources={sources}
                    documents={documents}
                    lastTrainedAt={bot.last_trained_at}
                  />
                ) : null}

                {tab === "skills" ? (
                  <>
                    <SkillsIntro count={skillCount} />
                    <ActionsPanel
                      config={config}
                      channels={channels}
                      spaces={spaces}
                      knowledge={{
                        total: sources.length,
                        trained: sources.filter((s) => s.status === "trained").length,
                      }}
                      onChange={(actions) => updateConfig({ actions })}
                    />
                    <CustomActionsPanel
                      propertyId={propertyId}
                      chatbotId={bot.id}
                      actions={customActions}
                    />
                  </>
                ) : null}

                {tab === "conversations" ? (
                  <ConversationsTab
                    propertyId={propertyId}
                    chatbotId={bot.id}
                    conversations={conversations}
                  />
                ) : null}

                {/* Mounted on demand — the route runs a lazy Haiku labeling pass. */}
                {tab === "analytics" ? (
                  <AnalyticsTab propertyId={propertyId} chatbotId={bot.id} />
                ) : null}

                {tab === "share" ? (
                  <>
                    <ShareIntro status={status} />
                    <DeployPanel
                      chatbotId={bot.id}
                      propertyId={propertyId}
                      publicSlug={bot.public_slug}
                      status={status}
                      allowedDomains={bot.allowed_domains ?? []}
                      twilioNumber={bot.twilio_number ?? null}
                      channels={channels}
                      deployedChannelIds={deployedChannelIds}
                    />
                  </>
                ) : null}

                {tab === "settings" ? (
                  <SettingsSection
                    bot={bot}
                    config={config}
                    spaces={spaces}
                    onChange={updateConfig}
                  />
                ) : null}
              </div>
            </div>

            {/* Sticky test console — visible whichever tab is active, so every
                edit can be tried immediately. Tests run against SAVED config. */}
            <div className="lg:sticky lg:top-0 lg:self-start">
              <TestConsole
                propertyId={propertyId}
                chatbotId={bot.id}
                greeting={config.greeting}
                suggestedQuestions={config.suggestedQuestions}
                avatarEmoji={config.appearance.avatarEmoji}
                dirty={dirty}
                config={config}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Skills tab ------------------------------ */

function SkillsIntro({ count }: { count: number }) {
  return (
    <section>
      <div className="row">
        <h2 className="sec">Skills</h2>
        {count > 0 ? <span className="badge accent num">{count} active</span> : null}
      </div>
      <p className="muted" style={{ margin: "4px 0 0", maxWidth: "68ch", fontSize: 13 }}>
        Knowledge is what your bot <em>knows</em>; skills are what it can{" "}
        <em>do</em>. Each skill is a tool the bot calls mid-conversation —
        collecting a guest&apos;s details, filing a ticket to your team, or handing off to a human. Toggle the
        built-in skills below, or connect your own API as a custom skill.
      </p>
    </section>
  );
}

/* ------------------------------ Share tab ------------------------------- */

function ShareIntro({ status }: { status: ChatbotRow["status"] }) {
  return (
    <section>
      <h2 className="sec">Put this bot in front of guests</h2>
      <p className="muted" style={{ margin: "4px 0 0", maxWidth: "68ch", fontSize: 13 }}>
        Share the hosted page link or QR code, embed a floating chat bubble on
        your website, or connect it to a channel.
        {status !== "published" ? (
          <b style={{ color: "var(--g8-text)" }}>
            {" "}
            Publish the bot first — guests can&apos;t reach a draft.
          </b>
        ) : null}
      </p>
    </section>
  );
}

/* ------------------------------ Build tab ------------------------------- */

function BuildSection({
  config,
  onChange,
}: {
  config: ChatbotConfig;
  onChange: (patch: Partial<ChatbotConfig>) => void;
}) {
  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="field">
        <label className="label" htmlFor="bot-instructions">Instructions</label>
        <p className="hint" style={{ margin: 0 }}>
          Who the bot is, what it helps guests with, its tone, and what it must
          never do. The more specific, the better it behaves.
        </p>
        <textarea
          id="bot-instructions"
          value={config.instructions}
          onChange={(e) => onChange({ instructions: e.target.value })}
          rows={10}
          placeholder="You are the front-desk concierge for this property…"
          className="textarea mono"
          style={{ lineHeight: 1.55 }}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="field">
          <label className="label" htmlFor="bot-display-name">Display name</label>
          <input
            className="input"
            id="bot-display-name"
            value={config.appearance.displayName}
            onChange={(e) =>
              onChange({
                appearance: { ...config.appearance, displayName: e.target.value },
              })
            }
            placeholder="Front Desk"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="bot-emoji">Avatar emoji</label>
          <input
            className="input"
            id="bot-emoji"
            value={config.appearance.avatarEmoji}
            onChange={(e) =>
              onChange({
                appearance: { ...config.appearance, avatarEmoji: e.target.value },
              })
            }
            maxLength={4}
            style={{ width: 96 }}
          />
        </div>
      </section>

      <section className="field">
        <label className="label" htmlFor="bot-greeting">Greeting</label>
        <input
          className="input"
          id="bot-greeting"
          value={config.greeting}
          onChange={(e) => onChange({ greeting: e.target.value })}
          placeholder="Hi! How can I help you today?"
        />
      </section>

      <section className="field">
        <span className="label">Suggested questions</span>
        <p className="hint" style={{ margin: 0 }}>
          Up to four tappable starters guests see before they type.
        </p>
        {[0, 1, 2, 3].map((i) => (
          <input
            className="input"
            key={i}
            value={config.suggestedQuestions[i] ?? ""}
            onChange={(e) => {
              const next = [...config.suggestedQuestions];
              next[i] = e.target.value;
              onChange({
                suggestedQuestions: next.filter((q, idx) => q.trim() || idx <= i).slice(0, 4),
              });
            }}
            placeholder={i === 0 ? "What time is check-out?" : "Optional"}
          />
        ))}
      </section>
    </div>
  );
}

/* ----------------------------- Settings tab ----------------------------- */

function SettingsSection({
  bot,
  config,
  spaces,
  onChange,
}: {
  bot: ChatbotRow;
  config: ChatbotConfig;
  spaces: SpaceOption[];
  onChange: (patch: Partial<ChatbotConfig>) => void;
}) {
  const router = useRouter();
  const [dailyCap, setDailyCap] = useState(String(bot.daily_message_cap));
  const [sessionCap, setSessionCap] = useState(String(bot.session_message_cap));

  function saveCaps() {
    const daily = Math.max(10, Math.min(10000, Number(dailyCap) || 0));
    const session = Math.max(5, Math.min(200, Number(sessionCap) || 0));
    setDailyCap(String(daily));
    setSessionCap(String(session));
    if (daily === bot.daily_message_cap && session === bot.session_message_cap) return;
    void updateChatbot({
      chatbotId: bot.id,
      patch: { daily_message_cap: daily, session_message_cap: session },
    }).then((result) => {
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Limits updated");
        router.refresh();
      }
    });
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="field">
        <label className="label" htmlFor="bot-model">Model</label>
        <select
          className="select"
          id="bot-model"
          value={config.modelTier}
          onChange={(e) =>
            onChange({ modelTier: e.target.value as ChatbotConfig["modelTier"] })
          }
        >
          <option value="standard">Standard — fast and economical (FAQ bots)</option>
          <option value="advanced">Advanced — strongest (order-taking, multi-step)</option>
        </select>
      </section>

      {spaces.length > 0 ? (
        <section className="field">
          <label className="label" htmlFor="bot-default-team">Default team for tickets</label>
          <select
          className="select"
            id="bot-default-team"
            value={config.defaultTeamId ?? ""}
            onChange={(e) =>
              onChange({ defaultTeamId: e.target.value || undefined })
            }
          >
            <option value="">Unassigned — let AI route by topic</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="hint" style={{ margin: 0 }}>
            Where tickets the bot raises land. Leave unassigned and triage
            routes each to the right team using the org chart.
          </p>
        </section>
      ) : null}

      <section className="panel stack" style={{ padding: 14, gap: 12 }}>
        <p className="label" style={{ margin: 0 }}>Answer strictness</p>
        <label className="row" style={{ alignItems: "flex-start", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={config.guardrails.onlyFromSources}
            onChange={(e) =>
              onChange({
                guardrails: { ...config.guardrails, onlyFromSources: e.target.checked },
              })
            }
            style={{ marginTop: 2 }}
          />
          <span>
            Only answer from knowledge
            <span className="hint" style={{ display: "block" }}>
              The bot never guesses prices, hours, or policies — if it isn&apos;t
              in the knowledge base, it says so and offers the team.
            </span>
          </span>
        </label>
        <div className="field">
          <label className="label" htmlFor="bot-fallback">When it can&apos;t help, it says</label>
          <input
            className="input"
            id="bot-fallback"
            value={config.guardrails.fallbackMessage}
            onChange={(e) =>
              onChange({
                guardrails: { ...config.guardrails, fallbackMessage: e.target.value },
              })
            }
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="bot-handoff">When handing off, it says</label>
          <input
            className="input"
            id="bot-handoff"
            value={config.guardrails.handoffMessage}
            onChange={(e) =>
              onChange({
                guardrails: { ...config.guardrails, handoffMessage: e.target.value },
              })
            }
          />
        </div>
      </section>

      <section className="panel stack" style={{ padding: 14, gap: 12 }}>
        <p className="label" style={{ margin: 0 }}>Limits</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="bot-daily-cap">Bot replies per day</label>
            <input
              className="input"
              id="bot-daily-cap"
              inputMode="numeric"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              onBlur={saveCaps}
            />
            <p className="hint" style={{ margin: 0 }}>
              Past this, guests get the fallback message until midnight.
            </p>
          </div>
          <div className="field">
            <label className="label" htmlFor="bot-session-cap">Guest messages per conversation</label>
            <input
              className="input"
              id="bot-session-cap"
              inputMode="numeric"
              value={sessionCap}
              onChange={(e) => setSessionCap(e.target.value)}
              onBlur={saveCaps}
            />
            <p className="hint" style={{ margin: 0 }}>
              Past this, the bot wraps up and offers a human.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
