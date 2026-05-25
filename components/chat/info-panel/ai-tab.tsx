"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useChannelStateContext } from "stream-chat-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BOT_DISPLAY_NAME, BOT_USER_ID } from "@/lib/ai/bot-identity";

type AiMode = "mention" | "engaged" | "auto" | "always";
type AiSensitivity = "conservative" | "balanced" | "eager";

const MODE_OPTIONS: { value: AiMode; label: string }[] = [
  { value: "mention", label: "Mention" },
  { value: "engaged", label: "Engaged" },
  { value: "auto", label: "Auto" },
  { value: "always", label: "Always" },
];

const SENSITIVITY_OPTIONS: { value: AiSensitivity; label: string }[] = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "eager", label: "Eager" },
];

const MODE_DESCRIPTIONS: Record<AiMode, string> = {
  mention: `Replies only when you @${BOT_USER_ID}. Replies in the same thread you mentioned it in.`,
  engaged: `Mention the bot to start a conversation. It keeps replying to follow-ups in that thread (and follows the conversation if it forks) until the topic resolves or moves on, then signs off. Best for "I want to work with the bot on something."`,
  auto: "The bot listens to every message and chimes in when it has something useful to add — answers, context, corrections, or offers to set something up. Direct mentions still always get a reply.",
  always:
    "Replies to every top-level channel message. Thread replies still require a mention. Best for 1:1 AI channels.",
};

const SENSITIVITY_DESCRIPTIONS: Record<AiSensitivity, string> = {
  conservative:
    "Chimes in only for unaddressed questions, factual corrections, or offers to fetch/set something up.",
  balanced:
    "Also adds relevant property context and brief clarifying questions when the discussion is ambiguous.",
  eager:
    "Also chimes in with summaries and useful related ideas. Most participatory — may feel chatty.",
};

/**
 * In-channel AI activation + per-channel response mode + auto-mode
 * sensitivity. All three are stored as Stream channel custom fields so
 * the webhook can read them without a DB round-trip.
 */
export function AiTab() {
  const { channel } = useChannelStateContext();
  const [botMember, setBotMember] = useState(() =>
    isBotMember(channel.state.members),
  );
  const [mode, setMode] = useState<AiMode>(() => readMode(channel.data));
  const [sensitivity, setSensitivity] = useState<AiSensitivity>(() =>
    readSensitivity(channel.data),
  );
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onMembers = () => setBotMember(isBotMember(channel.state.members));
    const sub1 = channel.on("member.added", onMembers);
    const sub2 = channel.on("member.removed", onMembers);
    const sub3 = channel.on("channel.updated", () => {
      setMode(readMode(channel.data));
      setSensitivity(readSensitivity(channel.data));
    });
    return () => {
      sub1.unsubscribe();
      sub2.unsubscribe();
      sub3.unsubscribe();
    };
  }, [channel]);

  async function activate() {
    if (!channel.id) return;
    setBusy(true);
    try {
      const res = await fetch("/api/stream/ai/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: channel.id,
          channelType: channel.type,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json().catch(() => ({}))) as {
        warning?: string;
      };
      try {
        await channel.queryMembers({});
      } catch (e) {
        console.error("[ai-tab] queryMembers after activation failed", e);
      }
      if (json.warning) toast.warning(json.warning);
      else toast.success(`${BOT_DISPLAY_NAME} added to this channel`);
      setBotMember(true);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn’t activate the assistant",
      );
    } finally {
      setBusy(false);
    }
  }

  async function persistSettings(next: {
    mode: AiMode;
    sensitivity: AiSensitivity;
  }) {
    if (!channel.id) return;
    setSaving(true);
    const prev = { mode, sensitivity };
    setMode(next.mode);
    setSensitivity(next.sensitivity);
    try {
      const res = await fetch("/api/stream/ai/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: channel.id,
          channelType: channel.type,
          mode: next.mode,
          // Only send sensitivity when in auto mode — keeps the stored
          // channel data tidy when the user isn't using auto.
          ...(next.mode === "auto" ? { sensitivity: next.sensitivity } : {}),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setMode(prev.mode);
      setSensitivity(prev.sensitivity);
      toast.error(
        e instanceof Error ? e.message : "Couldn’t change reply settings",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-1">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-foreground">
            {BOT_DISPLAY_NAME} AI
          </p>
          <p className="text-xs text-muted-foreground">
            An in-channel teammate powered by Claude. Has tools to look up
            tasks, documents, and meetings in this property.
          </p>
        </div>
      </div>

      {!botMember ? (
        <Button
          type="button"
          onClick={activate}
          disabled={busy}
          className="self-start"
        >
          {busy ? "Activating…" : `Activate ${BOT_DISPLAY_NAME}`}
        </Button>
      ) : (
        <>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Active.</span> The
            assistant is a member of this channel.
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[12px] font-medium text-foreground">
              Reply mode
            </legend>
            <div className="inline-flex rounded-md border border-border bg-background p-0.5">
              {MODE_OPTIONS.map((opt) => (
                <ModeButton
                  key={opt.value}
                  active={mode === opt.value}
                  disabled={saving}
                  onClick={() =>
                    persistSettings({ mode: opt.value, sensitivity })
                  }
                >
                  {opt.label}
                </ModeButton>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {MODE_DESCRIPTIONS[mode]}
            </p>
          </fieldset>

          {mode === "auto" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[12px] font-medium text-foreground">
                Chime sensitivity
              </legend>
              <select
                value={sensitivity}
                disabled={saving}
                onChange={(e) =>
                  persistSettings({
                    mode,
                    sensitivity: e.target.value as AiSensitivity,
                  })
                }
                className={cn(
                  "h-8 rounded-md border border-border bg-background px-2 text-[12px]",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                  "disabled:opacity-50",
                )}
              >
                {SENSITIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                {SENSITIVITY_DESCRIPTIONS[sensitivity]}
              </p>
            </fieldset>
          ) : null}
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        Requires{" "}
        <code className="rounded bg-muted px-1 py-0.5">ANTHROPIC_API_KEY</code>{" "}
        on the server.
      </p>
    </div>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-sm px-2.5 py-1 text-[12px] transition disabled:opacity-50",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function isBotMember(
  members:
    | Record<string, { user?: { id?: string } | null } | undefined>
    | undefined,
) {
  if (!members) return false;
  return Object.values(members).some((m) => m?.user?.id === BOT_USER_ID);
}

function readMode(data: Record<string, unknown> | undefined): AiMode {
  const raw = (data as { ai_mode?: string } | undefined)?.ai_mode;
  if (raw === "always" || raw === "auto" || raw === "engaged") return raw;
  return "mention";
}

function readSensitivity(
  data: Record<string, unknown> | undefined,
): AiSensitivity {
  const raw = (data as { ai_sensitivity?: string } | undefined)?.ai_sensitivity;
  if (raw === "conservative" || raw === "eager") return raw;
  return "balanced";
}
