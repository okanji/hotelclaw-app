"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useChannelStateContext } from "stream-chat-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BOT_DISPLAY_NAME, BOT_USER_ID } from "@/lib/ai/bot-identity";

type AiMode = "mention" | "engaged" | "auto" | "always";
type AiSensitivity = "conservative" | "balanced" | "eager";

/** Short, header-menu copy. The full prose lives on the (removed) AI tab. */
const MODE_OPTIONS: { value: AiMode; label: string; hint: string }[] = [
  { value: "mention", label: "Mention", hint: `Replies only when you @${BOT_USER_ID}.` },
  {
    value: "engaged",
    label: "Engaged",
    hint: "Mention to start, then it stays in the thread until the topic wraps.",
  },
  {
    value: "auto",
    label: "Auto",
    hint: "Listens to the channel and chimes in when it can help.",
  },
  {
    value: "always",
    label: "Always",
    hint: "Replies to every top-level message. Best for 1:1 AI channels.",
  },
];

const SENSITIVITY_OPTIONS: { value: AiSensitivity; label: string; hint: string }[] = [
  {
    value: "conservative",
    label: "Conservative",
    hint: "Only unaddressed questions, corrections, or offers to help.",
  },
  {
    value: "balanced",
    label: "Balanced",
    hint: "Also adds relevant context and brief clarifying questions.",
  },
  {
    value: "eager",
    label: "Eager",
    hint: "Also summaries and related ideas. Most participatory.",
  },
];

/**
 * Channel-header AI control. Sibling to the Meet button: a split-style
 * trigger that shows the assistant's current reply mode and opens a menu to
 * change it. Replaces the old "AI" tab in the channel info panel — activation,
 * reply mode, and auto-mode sensitivity all live here now, still persisted as
 * Stream channel custom fields so the webhook reads them without a DB hop.
 */
export function AiButton() {
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
      const json = (await res.json().catch(() => ({}))) as { warning?: string };
      try {
        await channel.queryMembers({});
      } catch (e) {
        console.error("[ai-button] queryMembers after activation failed", e);
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
          // Only send sensitivity in auto mode — keeps stored channel data
          // tidy when the user isn't using auto.
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

  const modeLabel = MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "AI";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="outline"
            size="default"
            title={
              botMember ? `AI replies: ${modeLabel}` : "Set up the AI assistant"
            }
            aria-label="AI assistant"
            className="gap-1.5 bg-transparent px-2.5 dark:bg-transparent"
          >
            <Sparkles
              className={cn(
                "size-4",
                botMember ? "text-foreground" : "text-muted-foreground",
              )}
            />
            <span className={cn(!botMember && "text-muted-foreground")}>
              {botMember ? modeLabel : "AI"}
            </span>
            {/* Internal seam echoes the Meet button's split look. */}
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" sideOffset={4} className="w-72">
        {botMember ? (
          <>
            <div className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" />
              Reply mode
            </div>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(v) =>
                persistSettings({ mode: v as AiMode, sensitivity })
              }
            >
              {MODE_OPTIONS.map((opt) => (
                <DropdownMenuRadioItem
                  key={opt.value}
                  value={opt.value}
                  disabled={saving}
                  className="items-start py-1.5"
                >
                  <div className="flex flex-col gap-0.5 pr-2">
                    <span className="text-sm font-medium text-foreground">
                      {opt.label}
                    </span>
                    <span className="text-xs leading-snug text-muted-foreground">
                      {opt.hint}
                    </span>
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>

            {mode === "auto" ? (
              <>
                <DropdownMenuSeparator />
                <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
                  Chime sensitivity
                </div>
                <DropdownMenuRadioGroup
                  value={sensitivity}
                  onValueChange={(v) =>
                    persistSettings({ mode, sensitivity: v as AiSensitivity })
                  }
                >
                  {SENSITIVITY_OPTIONS.map((opt) => (
                    <DropdownMenuRadioItem
                      key={opt.value}
                      value={opt.value}
                      disabled={saving}
                      className="items-start py-1.5"
                    >
                      <div className="flex flex-col gap-0.5 pr-2">
                        <span className="text-sm font-medium text-foreground">
                          {opt.label}
                        </span>
                        <span className="text-xs leading-snug text-muted-foreground">
                          {opt.hint}
                        </span>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="px-2 py-1.5">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Sparkles className="size-3.5" />
                {BOT_DISPLAY_NAME} AI
              </p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground text-pretty">
                An in-channel teammate powered by Claude. It can look up tasks,
                documents, and meetings in this property.
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              // Keep the menu open across the async activation so the freshly
              // revealed mode list lands in the same surface.
              closeOnClick={false}
              onClick={() => void activate()}
              disabled={busy}
            >
              <Sparkles className="size-4" />
              {busy ? "Activating…" : "Activate in this channel"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
