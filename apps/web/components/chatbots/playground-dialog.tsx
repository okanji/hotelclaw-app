"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/ui/chip";
import type { ChatbotConfig } from "@/lib/chatbots/schema";
import { NativeSelect } from "@/components/ui/native-select";
import { ChatBubble, ThinkingRow, ToolCallList } from "./chat/primitives";

/**
 * Playground compare — the Chatbase synced-panes pattern. Two panes run the
 * SAME guest message through the sandbox test route with independent
 * config overrides (model tier, instructions, strictness), so prompt and
 * model changes can be A/B'd before saving anything.
 */

type Turn = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; input: unknown }[];
  ms?: number;
};

type PaneState = {
  label: string;
  modelTier: "standard" | "advanced";
  instructions: string;
  onlyFromSources: boolean;
  turns: Turn[];
};

export function PlaygroundDialog({
  propertyId,
  chatbotId,
  config,
  open,
  onOpenChange,
}: {
  propertyId: string;
  chatbotId: string;
  config: ChatbotConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const base = (label: string): PaneState => ({
    label,
    modelTier: config.modelTier,
    instructions: config.instructions,
    onlyFromSources: config.guardrails.onlyFromSources,
    turns: [],
  });
  const [panes, setPanes] = useState<[PaneState, PaneState]>(() => [
    base("A"),
    { ...base("B"), modelTier: config.modelTier === "standard" ? "advanced" : "standard" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  function patchPane(index: 0 | 1, patch: Partial<PaneState>) {
    setPanes((prev) => {
      const next: [PaneState, PaneState] = [...prev] as [PaneState, PaneState];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  async function runPane(pane: PaneState, text: string): Promise<Turn> {
    const started = performance.now();
    const messages = [...pane.turns, { role: "user" as const, content: text }].map(
      ({ role, content }) => ({ role, content }),
    );
    const res = await fetch(
      `/api/properties/${propertyId}/chatbots/${chatbotId}/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          override: {
            modelTier: pane.modelTier,
            instructions: pane.instructions,
            onlyFromSources: pane.onlyFromSources,
          },
        }),
      },
    );
    if (!res.ok) {
      return { role: "assistant", content: "(request failed)", ms: 0 };
    }
    const data = (await res.json()) as {
      reply: string;
      toolCalls: { name: string; input: unknown }[];
    };
    return {
      role: "assistant",
      content: data.reply,
      toolCalls: data.toolCalls,
      ms: Math.round(performance.now() - started),
    };
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setPanes(
      (prev) =>
        prev.map((p) => ({
          ...p,
          turns: [...p.turns, { role: "user" as const, content: text }],
        })) as [PaneState, PaneState],
    );
    try {
      // Both panes run concurrently against the same message.
      const replies = await Promise.all(
        panes.map((pane) => runPane(pane, text)),
      );
      setPanes(
        (prev) =>
          prev.map((p, i) => ({ ...p, turns: [...p.turns, replies[i]] })) as [
            PaneState,
            PaneState,
          ],
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Playground — compare configurations</DialogTitle>
          <DialogDescription>
            The same message runs through both panes (sandboxed — no real
            tickets). Tweak a pane&apos;s model or instructions and see which
            answers better, then copy the winner into the builder.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {panes.map((pane, i) => (
            <Pane
              key={pane.label}
              pane={pane}
              busy={busy}
              onPatch={(patch) => patchPane(i as 0 | 1, patch)}
            />
          ))}
        </div>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message both panes as a guest…"
            rows={1}
            disabled={busy}
            className="flex-1 resize-none text-sm"
          />
          <Button type="submit" disabled={busy || !input.trim()}>
            {busy ? "Running…" : "Send to both"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Pane({
  pane,
  busy,
  onPatch,
}: {
  pane: PaneState;
  busy: boolean;
  onPatch: (patch: Partial<PaneState>) => void;
}) {
  const [showInstructions, setShowInstructions] = useState(false);
  return (
    <div className="flex min-h-[320px] flex-col rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {pane.label}
        </span>
        <NativeSelect
          value={pane.modelTier}
          onChange={(e) =>
            onPatch({ modelTier: e.target.value as PaneState["modelTier"] })
          }
          aria-label={`Pane ${pane.label} model`}
        >
          <option value="standard">Standard (Haiku)</option>
          <option value="advanced">Advanced (Sonnet)</option>
        </NativeSelect>
        <Chip
          size="sm"
          selected={pane.onlyFromSources}
          onClick={() => onPatch({ onlyFromSources: !pane.onlyFromSources })}
        >
          strict
        </Chip>
        <button
          type="button"
          onClick={() => setShowInstructions((s) => !s)}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          {showInstructions ? "Hide instructions" : "Edit instructions"}
        </button>
      </div>

      {showInstructions ? (
        <Textarea
          value={pane.instructions}
          onChange={(e) => onPatch({ instructions: e.target.value })}
          rows={5}
          className="m-2 font-mono text-xs"
        />
      ) : null}

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {pane.turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <ChatBubble side="end" tone="solid" compact className="max-w-[90%]">
                {t.content}
              </ChatBubble>
            </div>
          ) : (
            <div key={i} className="space-y-1">
              {t.toolCalls && t.toolCalls.length > 0 ? (
                <ToolCallList calls={t.toolCalls} />
              ) : null}
              <ChatBubble side="start" compact className="max-w-[90%]">
                {t.content}
              </ChatBubble>
              {t.ms ? (
                <p className="text-xs text-muted-foreground">{t.ms}ms</p>
              ) : null}
            </div>
          ),
        )}
        {busy ? <ThinkingRow compact /> : null}
      </div>
    </div>
  );
}
