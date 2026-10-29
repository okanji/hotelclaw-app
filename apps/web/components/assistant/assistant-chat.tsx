"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEveSession } from "@/hooks/use-eve-session";
import { EveConversation } from "@/components/ai/eve-conversation";
import { assistantChatsKey } from "@/lib/query/assistant-queries";
import { STARTER_PROMPTS } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";
import { AssistantComposer } from "./assistant-composer";
import { recordChatTurn } from "./actions";

/**
 * One conversation, backed by one durable eve session.
 *
 * Transport, resume, park handling and 409 recovery live in `useEveSession`
 * (shared with the Agents chat); rendering lives in `EveConversation` (AI
 * Elements — shared with every eve surface). What this component owns is the
 * assistant's identity: the virtual `assistant` bot, the optional project
 * header, the now-line framing, the chat row that records the session, and
 * the page-scale composer with @-mentions.
 *
 * MOUNTED-WHILE-HIDDEN. The workspace keeps every open tab's pane mounted and
 * hides the inactive ones, so switching tabs is instant and a turn running in
 * a background tab keeps streaming into its own transcript. That is the whole
 * reason each pane owns its session rather than a shared store.
 */

type SessionState = { id: string; continuationToken: string | null };

export function AssistantChat({
  propertyId,
  chatId,
  projectId,
  projectName,
  initialSession,
  /** Sent automatically on mount — how a chat started from the home composer
   *  or a starter prompt carries its first message across the navigation. */
  pendingMessage,
  onPendingConsumed,
  onTitle,
  active,
}: {
  propertyId: string;
  chatId: string;
  projectId: string | null;
  projectName: string | null;
  initialSession: SessionState | null;
  pendingMessage?: string | null;
  onPendingConsumed?: () => void;
  onTitle?: (title: string) => void;
  active: boolean;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");

  const headers = useCallback(
    (): Record<string, string> => ({
      "content-type": "application/json",
      "x-hotelclaw-property": propertyId,
      "x-hotelclaw-bot": "assistant",
      ...(projectId ? { "x-hotelclaw-project": projectId } : {}),
    }),
    [propertyId, projectId],
  );

  // The runtime resolves "today" from the model's training data without
  // this — a probe once scheduled a meeting a year in the past.
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
      const title = isFirstTurn ? message.slice(0, 140) : undefined;
      if (title) onTitle?.(title);
      await recordChatTurn({
        chatId,
        eveSessionId: sessionId,
        continuationToken: null,
        title,
      });
      void qc.invalidateQueries({ queryKey: assistantChatsKey(propertyId) });
    },
    [chatId, onTitle, propertyId, qc],
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
    async (text: string) => {
      setInput("");
      await session.send(text);
    },
    [session],
  );

  // A chat opened from the home composer arrives with its first message.
  const pendingRef = useRef(false);
  useEffect(() => {
    if (pendingRef.current || !pendingMessage?.trim()) return;
    pendingRef.current = true;
    onPendingConsumed?.();
    void send(pendingMessage);
  }, [pendingMessage, onPendingConsumed, send]);

  return (
    <div
      className={cn("min-h-0 min-w-0 flex-1 flex-col", active ? "flex" : "hidden")}
      // Inactive panes stay mounted (streaming keeps running) but are taken
      // out of the a11y tree and the tab order along with the visual hide.
      aria-hidden={!active}
      inert={!active ? true : undefined}
    >
      <EveConversation
        items={session.items}
        busy={session.busy}
        resuming={session.resuming}
        scale="page"
        onSend={send}
        onRespond={session.respond}
        feedback={{ propertyId, surface: "assistant", sessionId: session.sessionId }}
        empty={<EmptyState projectName={projectName} onPick={(prompt) => void send(prompt)} />}
      />

      <div className="shrink-0 px-6 pb-5">
        <div className="mx-auto w-full max-w-content">
          <AssistantComposer
            value={input}
            onChange={setInput}
            onSubmit={() => void send(input)}
            propertyId={propertyId}
            busy={session.busy}
            autoFocus={active}
            placeholder={
              session.pending.length > 0
                ? "Answer the question above, or type a message…"
                : projectName
                  ? `Message the assistant in ${projectName}…`
                  : "Write a message…"
            }
            trailing={
              projectName ? (
                <span className="badge gray trunc">{projectName}</span>
              ) : null
            }
          />
          <p className="faint" style={{ margin: "8px 0 0", textAlign: "center", fontSize: "var(--g8-fs-xs)" }}>
            The assistant can read and change your workspace. Check anything
            important.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The opening screen of a brand-new conversation. */
function EmptyState({
  projectName,
  onPick,
}: {
  projectName: string | null;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 pt-16 text-center">
      <div className="ph" style={{ justifyContent: "center", margin: 0 }}>
        <div>
        <h1>
          {projectName ? `What are we doing in ${projectName}?` : "What can I help with?"}
        </h1>
        <p style={{ maxWidth: 440, marginInline: "auto" }}>
          I can see your tasks, documents, calendar, conversations,
          and everything this property has learned — and I can change them too.
        </p>
        </div>
      </div>
      <ul role="list" className="flex flex-wrap justify-center gap-2">
        {STARTER_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              onClick={() => onPick(prompt)}
              className="btn btn-secondary btn-sm"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
