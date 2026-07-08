"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Copy,
  MessagesSquare,
  Puzzle,
  Settings2,
  Share2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  parseChatbotConfig,
  type ChatbotConfig,
  type ChatbotRow,
} from "@/lib/chatbots/schema";
import { ChatbotStatusBadge } from "./chatbots-list";
import { ActionsPanel, type BookableServiceOption } from "./actions-panel";
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
import { NativeSelect } from "@/components/ui/native-select";

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
  services = [],
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
  services?: BookableServiceOption[];
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

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-y-auto px-6 pt-8 pb-16 sm:px-10">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href={`/p/${propertyId}/chatbots`}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Back to chatbots"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <span className="text-xl">{config.appearance.avatarEmoji}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(bot.name);
          }}
          aria-label="Chatbot name"
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
          placeholder="Untitled chatbot"
        />
        <ChatbotStatusBadge status={status} />
        <Button variant="outline" size="sm" onClick={copyGuestLink}>
          <Copy data-slot="icon" />
          Guest link
        </Button>
        {dirty ? (
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : null}
        {status !== "published" ? (
          <Button
            size="sm"
            onClick={() => setBotStatus("published")}
            disabled={savingStatus}
          >
            Publish
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBotStatus("paused")}
            disabled={savingStatus}
          >
            Pause
          </Button>
        )}
      </header>

      <div className="mt-6 grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <Tabs
          value={tab}
          onValueChange={(t) => setTab(t as typeof tab)}
          className="flex min-w-0 flex-col"
        >
          <TabsList
            variant="line"
            className="h-auto w-full justify-start gap-1 overflow-x-auto border-b border-border pb-0"
          >
            <TabTrigger value="build" icon={Wand2} label="Build" />
            <TabTrigger
              value="knowledge"
              icon={BookOpen}
              label="Knowledge"
              count={sources.length}
            />
            <TabTrigger
              value="skills"
              icon={Puzzle}
              label="Skills"
              count={skillCount}
            />
            <TabTrigger
              value="conversations"
              icon={MessagesSquare}
              label="Conversations"
              count={conversations.length}
            />
            <TabTrigger value="analytics" icon={BarChart3} label="Analytics" />
            <TabTrigger value="share" icon={Share2} label="Share" />
            <TabTrigger value="settings" icon={Settings2} label="Settings" />
          </TabsList>

          <TabsContent value="build" className="mt-5 space-y-6">
            <BuildSection config={config} onChange={updateConfig} />
          </TabsContent>

          <TabsContent value="knowledge" className="mt-5">
            <KnowledgePanel
              propertyId={propertyId}
              chatbotId={bot.id}
              sources={sources}
              documents={documents}
              lastTrainedAt={bot.last_trained_at}
            />
          </TabsContent>

          <TabsContent value="skills" className="mt-5 space-y-6">
            <SkillsIntro count={skillCount} />
            <ActionsPanel
              config={config}
              channels={channels}
              spaces={spaces}
              services={services}
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
          </TabsContent>

          <TabsContent value="conversations" className="mt-5">
            <ConversationsTab
              propertyId={propertyId}
              chatbotId={bot.id}
              conversations={conversations}
            />
          </TabsContent>

          <TabsContent value="analytics" className="mt-5">
            {/* Mounted on demand — the route runs a lazy Haiku labeling pass. */}
            {tab === "analytics" ? (
              <AnalyticsTab propertyId={propertyId} chatbotId={bot.id} />
            ) : null}
          </TabsContent>

          <TabsContent value="share" className="mt-5 space-y-6">
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
          </TabsContent>

          <TabsContent value="settings" className="mt-5 space-y-6">
            <SettingsSection
              bot={bot}
              config={config}
              spaces={spaces}
              onChange={updateConfig}
            />
          </TabsContent>
        </Tabs>

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
  );
}

/* ------------------------------ Tab trigger ----------------------------- */

/** Underline tab with a micro icon and an optional count chip. */
function TabTrigger({
  value,
  icon: Icon,
  label,
  count,
}: {
  value: string;
  icon: typeof Wand2;
  label: string;
  count?: number;
}) {
  return (
    <TabsTrigger value={value} className="flex-none gap-1.5 px-3">
      <Icon className="size-4 shrink-0" />
      {label}
      {typeof count === "number" && count > 0 ? (
        <span className="ml-0.5 rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground group-data-[variant=line]/tabs-list:in-data-active:bg-foreground/10 group-data-[variant=line]/tabs-list:in-data-active:text-foreground">
          {count}
        </span>
      ) : null}
    </TabsTrigger>
  );
}

/* ------------------------------ Skills tab ------------------------------ */

function SkillsIntro({ count }: { count: number }) {
  return (
    <section className="space-y-1">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight">Skills</h2>
        {count > 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {count} active
          </span>
        ) : null}
      </div>
      <p className="max-w-[68ch] text-sm text-pretty text-muted-foreground">
        Knowledge is what your bot <em>knows</em>; skills are what it can{" "}
        <em>do</em>. Each skill is a tool the bot calls mid-conversation —
        collecting a guest&apos;s details, filing a ticket to your team, checking
        real availability and booking, or handing off to a human. Toggle the
        built-in skills below, or connect your own API as a custom skill.
      </p>
    </section>
  );
}

/* ------------------------------ Share tab ------------------------------- */

function ShareIntro({ status }: { status: ChatbotRow["status"] }) {
  return (
    <section className="space-y-1">
      <h2 className="text-base font-semibold tracking-tight">
        Put this bot in front of guests
      </h2>
      <p className="max-w-[68ch] text-sm text-pretty text-muted-foreground">
        Share the hosted page link or QR code, embed a floating chat bubble on
        your website, or connect it to a channel.
        {status !== "published" ? (
          <span className="font-medium text-foreground">
            {" "}
            Publish the bot first — guests can&apos;t reach a draft.
          </span>
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
    <div className="space-y-6">
      <section className="space-y-2">
        <Label htmlFor="bot-instructions">Instructions</Label>
        <p className="text-xs text-muted-foreground">
          Who the bot is, what it helps guests with, its tone, and what it must
          never do. The more specific, the better it behaves.
        </p>
        <Textarea
          id="bot-instructions"
          value={config.instructions}
          onChange={(e) => onChange({ instructions: e.target.value })}
          rows={10}
          placeholder="You are the front-desk concierge for this property…"
          className="font-mono text-sm leading-relaxed"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bot-display-name">Display name</Label>
          <Input
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
        <div className="space-y-2">
          <Label htmlFor="bot-emoji">Avatar emoji</Label>
          <Input
            id="bot-emoji"
            value={config.appearance.avatarEmoji}
            onChange={(e) =>
              onChange({
                appearance: { ...config.appearance, avatarEmoji: e.target.value },
              })
            }
            maxLength={4}
            className="w-24"
          />
        </div>
      </section>

      <section className="space-y-2">
        <Label htmlFor="bot-greeting">Greeting</Label>
        <Input
          id="bot-greeting"
          value={config.greeting}
          onChange={(e) => onChange({ greeting: e.target.value })}
          placeholder="Hi! How can I help you today?"
        />
      </section>

      <section className="space-y-2">
        <Label>Suggested questions</Label>
        <p className="text-xs text-muted-foreground">
          Up to four tappable starters guests see before they type.
        </p>
        {[0, 1, 2, 3].map((i) => (
          <Input
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
    <div className="space-y-6">
      <section className="space-y-2">
        <Label htmlFor="bot-model">Model</Label>
        <NativeSelect
          id="bot-model"
          value={config.modelTier}
          onChange={(e) =>
            onChange({ modelTier: e.target.value as ChatbotConfig["modelTier"] })
          }
        >
          <option value="standard">Standard — fast and economical (FAQ bots)</option>
          <option value="advanced">Advanced — strongest (order-taking, multi-step)</option>
        </NativeSelect>
      </section>

      {spaces.length > 0 ? (
        <section className="space-y-2">
          <Label htmlFor="bot-default-team">Default team for tickets</Label>
          <NativeSelect
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
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            Where tickets the bot raises land. Leave unassigned and triage
            routes each to the right team using the org chart.
          </p>
        </section>
      ) : null}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Answer strictness</p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.guardrails.onlyFromSources}
            onChange={(e) =>
              onChange({
                guardrails: { ...config.guardrails, onlyFromSources: e.target.checked },
              })
            }
            className="mt-0.5"
          />
          <span>
            Only answer from knowledge
            <span className="block text-xs text-muted-foreground">
              The bot never guesses prices, hours, or policies — if it isn&apos;t
              in the knowledge base, it says so and offers the team.
            </span>
          </span>
        </label>
        <div className="space-y-2">
          <Label htmlFor="bot-fallback">When it can&apos;t help, it says</Label>
          <Input
            id="bot-fallback"
            value={config.guardrails.fallbackMessage}
            onChange={(e) =>
              onChange({
                guardrails: { ...config.guardrails, fallbackMessage: e.target.value },
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bot-handoff">When handing off, it says</Label>
          <Input
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

      <section className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Limits</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bot-daily-cap">Bot replies per day</Label>
            <Input
              id="bot-daily-cap"
              inputMode="numeric"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              onBlur={saveCaps}
            />
            <p className="text-xs text-muted-foreground">
              Past this, guests get the fallback message until midnight.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bot-session-cap">Guest messages per conversation</Label>
            <Input
              id="bot-session-cap"
              inputMode="numeric"
              value={sessionCap}
              onChange={(e) => setSessionCap(e.target.value)}
              onBlur={saveCaps}
            />
            <p className="text-xs text-muted-foreground">
              Past this, the bot wraps up and offers a human.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
