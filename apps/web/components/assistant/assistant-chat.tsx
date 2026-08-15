"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import {
  createTranscriptReducer,
  type ToolCall,
  type TranscriptItem,
} from "@/lib/fleet/transcript";
import { assistantChatsKey } from "@/lib/query/assistant-queries";
import { SILENT_TOOLS, toolLabel } from "@/lib/assistant/tool-labels";
import { STARTER_PROMPTS } from "@/lib/assistant/types";
import { AiUiAttachment } from "@/components/chat/ai-ui-attachment";
import { cn } from "@/lib/utils";
import { AssistantComposer } from "./assistant-composer";
import { AssistantMarkdown } from "./assistant-markdown";
import { recordChatTurn } from "./actions";

/**
 * One conversation, backed by one durable eve session.
 *
 * The transport is the same as the Agents section's AgentChat — same-origin
 * `/eve/v1/*`, Supabase cookie auth, NDJSON stream replayed from index 0 so
 * the transcript is REBUILT from the event log on every attach (which is what
 * makes resuming a saved conversation free). What differs is the surface: the
 * assistant addresses the virtual `assistant` bot rather than a stored agent,
 * optionally carries a project header, and renders at page scale — full
 * markdown, inline render_ui cards, and tool calls as legible activity rows.
 *
 * MOUNTED-WHILE-HIDDEN. The workspace keeps every open tab's pane mounted and
 * hides the inactive ones, so switching tabs is instant and a turn running in
 * a background tab keeps streaming into its own transcript. That is the whole
 * reason this component owns its stream rather than a shared store.
 */

type SessionState = { id: string; continuationToken: string | null };

/**
 * The first message of a session is prefixed with a now-line so the model
 * resolves "tomorrow" against today rather than against its training data (a
 * probe on the channel path once scheduled a meeting a year in the past). It
 * is plumbing, not something the person wrote — strip it back out before the
 * stream replay renders their own message to them.
 */
const TURN_FRAMING_RX = /^\[Now: [^\]]*\]\s*\n+/;

function displayText(text: string): string {
  return text.replace(TURN_FRAMING_RX, "");
}

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
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(Boolean(initialSession?.id));

  const sessionRef = useRef<SessionState | null>(initialSession);
  // User turns the session is known to hold, kept current by every replay —
  // a follow-up must consume until the park FOLLOWING its own turn, not the
  // first park it sees (which is the PREVIOUS turn's, and stopping there
  // freezes the transcript one turn behind).
  const turnsRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef(false);
  const pinnedToBottomRef = useRef(true);

  const headers = useCallback(
    (): Record<string, string> => ({
      "content-type": "application/json",
      "x-hotelclaw-property": propertyId,
      "x-hotelclaw-bot": "assistant",
      ...(projectId ? { "x-hotelclaw-project": projectId } : {}),
    }),
    [propertyId, projectId],
  );

  const consumeStream = useCallback(
    async (sessionId: string, expectedTurns: number | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(`/eve/v1/session/${sessionId}/stream`, {
        headers: headers(),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Could not attach to the conversation (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let userTurns = 0;

      const reducer = createTranscriptReducer({
        onWaiting: (continuationToken) => {
          sessionRef.current = { id: sessionId, continuationToken };
          if (expectedTurns !== null && userTurns >= expectedTurns) {
            controller.abort();
          }
        },
        onFailed: () => {
          toast.error("That turn failed — try sending it again.");
          controller.abort();
        },
      });

      let sawData = false;
      try {
        for (;;) {
          // Resume (expectedTurns === null) races an idle window: a parked
          // session's replay simply goes quiet, with no further park event to
          // stop on. The FIRST chunk gets a long window — the eve proxy can
          // still be warming up right after a page load, and a 2s budget
          // there is what made resume return an empty transcript on a
          // conversation that was sitting in the log all along.
          const chunk =
            expectedTurns === null
              ? await Promise.race([
                  reader.read(),
                  new Promise<{ done: true; value?: undefined }>((resolve) =>
                    setTimeout(() => resolve({ done: true }), sawData ? 2000 : 20_000),
                  ),
                ])
              : await reader.read();
          if (chunk.done) break;
          sawData = true;
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as { type: string; data: Record<string, unknown> };
              if (event.type === "message.received") userTurns += 1;
              reducer.handle(event);
            } catch {
              // Partial writes on abort — skip.
            }
          }
          setTranscript([...reducer.items]);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          throw error;
        }
      } finally {
        reader.cancel().catch(() => {});
        setTranscript([...reducer.items]);
        turnsRef.current = Math.max(turnsRef.current, userTurns);
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
      pinnedToBottomRef.current = true;
      // Optimistic echo — the replay replaces it a beat later.
      setTranscript((prev) => [...prev, { kind: "user", text: message }]);

      try {
        const session = sessionRef.current;
        const isFollowUp = Boolean(session?.id && session?.continuationToken);
        // The runtime resolves "today" from the model's training data without
        // this — a probe once scheduled a meeting a year in the past.
        const framed = isFollowUp
          ? message
          : `[Now: ${new Date().toISOString()} (UTC)]\n\n${message}`;

        const response = await fetch(
          isFollowUp ? `/eve/v1/session/${session!.id}` : "/eve/v1/session",
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(
              isFollowUp
                ? { continuationToken: session!.continuationToken, message: framed }
                : { message: framed },
            ),
          },
        );
        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "You're not authorized for this workspace."
              : `The assistant runtime returned ${response.status}.`,
          );
        }
        const body = (await response.json()) as {
          sessionId?: string;
          continuationToken?: string;
        };
        const sessionId = body.sessionId ?? session?.id;
        if (!sessionId) throw new Error("No session id came back.");
        sessionRef.current = {
          id: sessionId,
          continuationToken: body.continuationToken ?? null,
        };

        if (!isFollowUp) turnsRef.current = 0;
        await consumeStream(sessionId, turnsRef.current + 1);

        const title = isFollowUp ? undefined : message.slice(0, 140);
        if (title) onTitle?.(title);
        await recordChatTurn({
          chatId,
          eveSessionId: sessionId,
          continuationToken: sessionRef.current?.continuationToken ?? null,
          title,
        });
        void qc.invalidateQueries({ queryKey: assistantChatsKey(propertyId) });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't reach the assistant",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, chatId, consumeStream, headers, onTitle, propertyId, qc],
  );

  // Resume a saved conversation on mount.
  //
  // RETRIED, and the stored session is NEVER discarded on a read failure.
  // Both of those are scar tissue: the eve proxy can answer 503 for a second
  // or two right after a page load, and the first cut treated that as "this
  // session is gone" — which emptied the transcript AND made the next message
  // open a brand-new eve session, silently forking a conversation the user
  // could see the title of in their sidebar. Failing to DISPLAY history is
  // recoverable; failing to CONTINUE it is not.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const session = sessionRef.current;
    if (!session?.id) {
      setResuming(false);
      return;
    }
    // No cancellation flag on purpose. `hydratedRef` already makes this run
    // exactly once, and React's development double-invoke fires the cleanup
    // between the two passes — a flag set there left `resuming` true forever,
    // so the pane sat on "Loading this conversation…" even after the retries
    // had finished. The unmount abort in the effect below is what actually
    // stops the read.
    void (async () => {
      try {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            await consumeStream(session.id, null);
            return;
          } catch {
            // In dev the very first request after a page load can 503 while
            // the eve route compiles. Back off and try again rather than
            // declaring a live conversation empty.
            if (attempt === 3) return;
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      } finally {
        setResuming(false);
      }
    })();
  }, [consumeStream]);

  // A chat opened from the home composer arrives with its first message.
  const pendingRef = useRef(false);
  useEffect(() => {
    if (pendingRef.current || !pendingMessage?.trim()) return;
    pendingRef.current = true;
    onPendingConsumed?.();
    void send(pendingMessage);
  }, [pendingMessage, onPendingConsumed, send]);

  // Abort the in-flight read when the pane unmounts (tab closed).
  useEffect(() => () => abortRef.current?.abort(), []);

  // Follow the tail, but stop fighting the user the moment they scroll up.
  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [transcript, busy]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const empty = transcript.length === 0 && !resuming;

  return (
    <div
      className={cn("min-h-0 flex-1 flex-col", active ? "flex" : "hidden")}
      // Inactive panes stay mounted (streaming keeps running) but are taken
      // out of the a11y tree and the tab order along with the visual hide.
      aria-hidden={!active}
      inert={!active ? true : undefined}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-content px-6 py-8">
          {empty ? (
            <EmptyState
              projectName={projectName}
              onPick={(prompt) => void send(prompt)}
            />
          ) : (
            <ol role="list" className="flex flex-col gap-7">
              {transcript.map((item, index) =>
                item.kind === "user" ? (
                  <li key={index} className="flex justify-end">
                    <div className="max-w-[85%] rounded-card bg-muted px-4 py-2.5 text-base leading-6 whitespace-pre-wrap">
                      {displayText(item.text)}
                    </div>
                  </li>
                ) : (
                  <li key={index} className="flex flex-col gap-3">
                    <ToolActivity calls={item.toolCalls} />
                    <RenderedViews calls={item.toolCalls} />
                    {item.text ? (
                      <AssistantMarkdown>{item.text}</AssistantMarkdown>
                    ) : null}
                  </li>
                ),
              )}
              {busy || resuming ? (
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {resuming ? "Loading this conversation…" : "Working on it…"}
                </li>
              ) : null}
            </ol>
          )}
        </div>
      </div>

      <div className="shrink-0 px-6 pb-5">
        <div className="mx-auto w-full max-w-content">
          <AssistantComposer
            value={input}
            onChange={setInput}
            onSubmit={() => void send(input)}
            busy={busy}
            autoFocus={active}
            placeholder={
              projectName ? `Message the assistant in ${projectName}…` : "Write a message…"
            }
            trailing={
              projectName ? (
                <span className="truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  {projectName}
                </span>
              ) : null
            }
          />
          <p className="mt-2 text-center text-xs text-faint-foreground">
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
      <div>
        <h2 className="text-2xl font-semibold tracking-normal">
          {projectName ? `What are we doing in ${projectName}?` : "What can I help with?"}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-base text-pretty text-muted-foreground">
          I can see your tasks, documents, calendar, bookings, conversations,
          and everything this property has learned — and I can change them too.
        </p>
      </div>
      <ul role="list" className="flex flex-wrap justify-center gap-2">
        {STARTER_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              onClick={() => onPick(prompt)}
              className="rounded-md bg-muted px-3 py-1.5 text-sm text-secondary-ink transition-colors hover:bg-accent"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the assistant did, as readable rows. The raw name and payload live one
 * disclosure away — a personal assistant with this much reach has to be
 * auditable, but not at the cost of a wall of JSON in the reading column.
 */
function ToolActivity({ calls }: { calls: ToolCall[] }) {
  const shown = calls.filter((call) => !SILENT_TOOLS.has(call.toolName));
  if (shown.length === 0) return null;
  return (
    <ul role="list" className="flex flex-col gap-1">
      {shown.map((call) => (
        <li key={call.callId}>
          <details className="group rounded-md text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent">
              <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
              <span className="min-w-0 truncate">{toolLabel(call.toolName)}</span>
              {call.done ? (
                <Check className="size-3.5 shrink-0 text-success" />
              ) : (
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
              )}
            </summary>
            <div className="mt-1 ml-7 flex flex-col gap-1.5">
              <code className="text-xs text-faint-foreground">{call.toolName}</code>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs leading-5">
                {JSON.stringify({ input: call.input, output: call.output }, null, 2)}
              </pre>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/**
 * Inline rich UI. The eve `render_ui` tool validates the spec and returns it
 * in the tool RESULT as `ai_ui_spec` (on the channel path the web glue then
 * posts it as a Stream attachment); here the transcript renders it directly
 * with the same catalog component the channel uses, so a table looks
 * identical wherever the assistant draws it.
 */
function RenderedViews({ calls }: { calls: ToolCall[] }) {
  const specs = useMemo(() => {
    const found: { callId: string; spec: unknown }[] = [];
    for (const call of calls) {
      if (call.toolName !== "render_ui" || !call.done) continue;
      const output = call.output as { ai_ui_spec?: unknown } | null | undefined;
      if (output && typeof output === "object" && output.ai_ui_spec) {
        found.push({ callId: call.callId, spec: output.ai_ui_spec });
      }
    }
    return found;
  }, [calls]);
  if (specs.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {specs.map((entry) => (
        <AiUiAttachment
          key={entry.callId}
          attachment={{ type: "ai_ui", spec: entry.spec } as never}
        />
      ))}
    </div>
  );
}
