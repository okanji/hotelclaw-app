"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TintIcon } from "@/components/ui/tint-card";
import { EveConversation } from "@/components/ai/eve-conversation";
import { useEveSession } from "@/hooks/use-eve-session";
import { recordAgentSession } from "./actions";

export type AgentChatSession = {
  id: string;
  continuationToken: string | null;
  title?: string;
};

/** Which AI a session addresses: a stored custom agent (agents table,
 * x-hotelclaw-agent) or a fleet pod bot (bots table, x-hotelclaw-bot).
 * Pod-bot sessions are ephemeral test chats — nothing is recorded
 * (recordAgentSession FKs public.agents). */
export type AgentChatTarget = { agentId: string } | { botSlug: string };

/**
 * Chat with an agent over eve's HTTP API — same-origin `/eve/v1/*` routes
 * (withEve), Supabase cookie auth verified by the agent's channel AuthFn,
 * property + target selected via headers. Transport lives in
 * `useEveSession`, rendering in `EveConversation` (mono tool labels here:
 * this is the transparency counterpart to the editor's grants list, so the
 * raw tool names are the point). Questions and approvals the agent parks on
 * are answered inline.
 */
export function AgentChat({
  propertyId,
  target,
  agentName,
  avatarEmoji,
  starterPrompts,
  paused,
  initialSession,
}: {
  propertyId: string;
  target: AgentChatTarget;
  agentName: string;
  avatarEmoji: string;
  starterPrompts: string[];
  paused: boolean;
  initialSession: AgentChatSession | null;
}) {
  const [input, setInput] = useState("");
  const targetAgentId = "agentId" in target ? target.agentId : null;
  const targetBotSlug = "botSlug" in target ? target.botSlug : null;

  const headers = useCallback(
    (): Record<string, string> => ({
      "content-type": "application/json",
      "x-hotelclaw-property": propertyId,
      ...(targetAgentId ? { "x-hotelclaw-agent": targetAgentId } : {}),
      ...(targetBotSlug ? { "x-hotelclaw-bot": targetBotSlug } : {}),
    }),
    [propertyId, targetAgentId, targetBotSlug],
  );

  const frameFirstMessage = useCallback(
    (text: string) => `[Now: ${new Date().toISOString()} (UTC)]\n\n${text}`,
    [],
  );

  const onTurn = useCallback(
    async ({
      sessionId,
      isFirstTurn,
      message,
    }: {
      sessionId: string;
      isFirstTurn: boolean;
      message: string;
    }) => {
      // Pod-bot test chats are ephemeral — agent_sessions FKs the agents
      // table, so only stored-agent sessions are recorded.
      if (!targetAgentId) return;
      await recordAgentSession({
        sessionId,
        agentId: targetAgentId,
        propertyId,
        title: isFirstTurn ? message.slice(0, 140) : undefined,
        continuationToken: null,
      });
    },
    [propertyId, targetAgentId],
  );

  const onError = useCallback((message: string) => toast.error(message), []);

  const session = useEveSession({
    headers,
    initialSessionId: initialSession?.id ?? null,
    frameFirstMessage,
    onTurn,
    onError,
  });

  const send = useCallback(
    (text: string) => {
      if (paused) return;
      setInput("");
      void session.send(text);
    },
    [paused, session],
  );

  const prompts = starterPrompts.filter((p) => p.trim());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <TintIcon tone="lavender" className="text-sm">
          {avatarEmoji || "🤖"}
        </TintIcon>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          Chat with {agentName}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={session.reset}
          aria-label="New conversation"
          disabled={session.busy}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>

      <EveConversation
        items={session.items}
        busy={session.busy}
        resuming={session.resuming}
        workingLabel={`${agentName} is working…`}
        scale="compact"
        mono
        onSend={send}
        onRespond={session.respond}
        feedback={
          targetAgentId
            ? { propertyId, surface: "agent", sessionId: session.sessionId }
            : null
        }
        empty={
          <div className="flex h-full flex-col items-center justify-center gap-3 pt-12 text-center">
            <p className="max-w-xs text-sm text-pretty text-muted-foreground">
              {paused
                ? "This agent is paused — activate it to chat."
                : "Ask anything. Tool calls show up inline so you can see exactly what it reads."}
            </p>
            {!paused && prompts.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => send(prompt)}
                    className="inline-flex h-7 items-center rounded-md bg-muted px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        }
      />

      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={
            paused
              ? "Agent is paused"
              : session.pending.length > 0
                ? "Answer above, or type a message…"
                : `Message ${agentName}…`
          }
          rows={1}
          disabled={paused || session.busy}
          className="min-h-9 flex-1 resize-none shadow-composer focus-visible:shadow-composer-focus"
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={paused || session.busy || !input.trim()}
          aria-label="Send"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
