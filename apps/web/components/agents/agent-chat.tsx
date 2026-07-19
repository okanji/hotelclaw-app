"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Send, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TintIcon } from "@/components/ui/tint-card";
import { ChatMarkdown } from "@/components/chatbots/chat-markdown";
import { cn } from "@/lib/utils";
import {
  createTranscriptReducer,
  type TranscriptItem,
} from "@/lib/fleet/transcript";
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
 * property + target selected via headers. The NDJSON event stream replays
 * from index 0 on every attach, so the transcript is REBUILT from the event
 * log each turn — which also makes resuming a saved session free. Tool
 * calls are rendered inline (name + expandable payload): the transparency
 * counterpart to the editor's grants list.
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
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<AgentChatSession | null>(initialSession);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef(false);

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

  /** Read the session's NDJSON stream, rebuilding the transcript from the
   * full event log. Resolves once the session parks (or the turn fails). */
  const consumeStream = useCallback(
    async (sessionId: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(`/eve/v1/session/${sessionId}/stream`, {
        headers: headers(),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`stream failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const reducer = createTranscriptReducer({
        onWaiting: (continuationToken) => {
          sessionRef.current = { id: sessionId, continuationToken };
          controller.abort();
        },
        onFailed: () => {
          toast.error("The agent run failed — try again.");
          controller.abort();
        },
      });
      const handle = (event: { type: string; data: Record<string, unknown> }) => {
        reducer.handle(event);
        setTranscript([...reducer.items]);
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              handle(JSON.parse(line));
            } catch {
              // Skip unparseable lines (partial writes on abort).
            }
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          throw error;
        }
      }
    },
    [headers],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setInput("");
      setBusy(true);
      // Optimistic echo — the stream replay will replace it.
      setTranscript((prev) => [...prev, { kind: "user", text: message }]);
      try {
        const session = sessionRef.current;
        const isFollowUp = Boolean(session?.id && session?.continuationToken);
        const response = await fetch(
          isFollowUp ? `/eve/v1/session/${session!.id}` : "/eve/v1/session",
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(
              isFollowUp
                ? { continuationToken: session!.continuationToken, message }
                : { message },
            ),
          },
        );
        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "Not authorized for this agent."
              : `The agent runtime returned ${response.status}.`,
          );
        }
        const body = (await response.json()) as {
          sessionId?: string;
          continuationToken?: string;
        };
        const sessionId = body.sessionId ?? session?.id;
        if (!sessionId) throw new Error("No session id returned.");
        sessionRef.current = {
          id: sessionId,
          continuationToken: body.continuationToken ?? null,
        };

        await consumeStream(sessionId);

        // Pod-bot test chats are ephemeral — agent_sessions FKs the agents
        // table, so only stored-agent sessions are recorded.
        if (targetAgentId) {
          await recordAgentSession({
            sessionId,
            agentId: targetAgentId,
            propertyId,
            title: isFollowUp ? undefined : message.slice(0, 140),
            continuationToken: sessionRef.current?.continuationToken ?? null,
          });
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to reach the agent",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, headers, consumeStream, targetAgentId, propertyId],
  );

  // Resume the saved conversation once on mount: attach to its stream to
  // rebuild the transcript (the replay ends at session.waiting).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const session = sessionRef.current;
    if (!session?.id) return;
    setBusy(true);
    consumeStream(session.id)
      .catch(() => {
        // A dead/expired session just starts fresh.
        sessionRef.current = null;
      })
      .finally(() => setBusy(false));
  }, [consumeStream]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript]);

  function newConversation() {
    abortRef.current?.abort();
    sessionRef.current = null;
    setTranscript([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <TintIcon tone="lavender" className="text-sm">
          {avatarEmoji || "🤖"}
        </TintIcon>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          Chat with {agentName}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={newConversation}
          aria-label="New conversation"
          disabled={busy}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {transcript.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-xs text-sm text-pretty text-muted-foreground">
              {paused
                ? "This agent is paused — activate it to chat."
                : "Ask anything. Tool calls show up inline so you can see exactly what it reads."}
            </p>
            {!paused && starterPrompts.filter((p) => p.trim()).length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {starterPrompts
                  .filter((p) => p.trim())
                  .map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => send(prompt)}
                      className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      {prompt}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ) : (
          <ul role="list" className="flex flex-col gap-4">
            {transcript.map((item, index) => (
              <li key={index}>
                {item.kind === "user" ? (
                  <div className="ml-8 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                    {item.text}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {item.toolCalls.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {item.toolCalls.map((call) => (
                          <details
                            key={call.callId}
                            className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs"
                          >
                            <summary className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                              <Wrench className="size-3 shrink-0" />
                              <code className="font-mono">{call.toolName}</code>
                              <span
                                className={cn(
                                  "ml-auto",
                                  call.done ? "text-success" : "animate-pulse",
                                )}
                              >
                                {call.done ? "done" : "running…"}
                              </span>
                            </summary>
                            <pre className="mt-2 max-h-48 overflow-auto rounded bg-background/80 p-2 font-mono text-[11px] leading-snug">
                              {JSON.stringify(
                                { input: call.input, output: call.output },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        ))}
                      </div>
                    ) : null}
                    {item.text ? (
                      <div className="text-sm">
                        <ChatMarkdown>{item.text}</ChatMarkdown>
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
            {busy ? (
              <li className="text-xs text-muted-foreground animate-pulse">
                {agentName} is working…
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-border/60 p-3"
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
          placeholder={paused ? "Agent is paused" : `Message ${agentName}…`}
          rows={1}
          disabled={paused || busy}
          className="min-h-9 flex-1 resize-none"
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={paused || busy || !input.trim()}
          aria-label="Send"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
