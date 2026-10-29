"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Send } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
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
      <div className="panel-h" style={{ borderBottom: "1px solid var(--g8-border)", paddingBottom: 12 }}>
        <span
          className="picon"
          style={{ "--g8-c": "var(--g8-violet)", "--g8-sz": "24px", fontSize: 13 } as React.CSSProperties}
        >
          {avatarEmoji || "🤖"}
        </span>
        <h2 className="trunc" style={{ flex: 1, minWidth: 0 }}>Chat with {agentName}</h2>
        <div className="acts">
          <button
            type="button"
            className="ibtn ibtn-sm"
            onClick={session.reset}
            aria-label="New conversation"
            title="New conversation"
            disabled={session.busy}
          >
            <Gi icon={RotateCcw} size={14} />
          </button>
        </div>
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
            <p className="muted" style={{ maxWidth: 300, margin: 0, fontSize: "var(--g8-fs-sm)" }}>
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
                    className="btn btn-secondary btn-sm"
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
        className="g8-ai-composer row"
        style={{ margin: 12, alignItems: "flex-end", gap: 8, padding: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
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
          className="flex-1 resize-none bg-transparent focus-visible:outline-none disabled:opacity-60"
          style={{ minHeight: 30, maxHeight: 200, padding: "5px 6px", lineHeight: 1.5 }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          style={{ width: "var(--g8-h-sm)", padding: 0 }}
          disabled={paused || session.busy || !input.trim()}
          aria-label="Send"
        >
          <Gi icon={Send} size={14} />
        </button>
      </form>
    </div>
  );
}
