"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTranscriptReducer,
  pendingInputRequests,
  type InputRequest,
  type TranscriptItem,
} from "@/lib/fleet/transcript";

/**
 * One durable eve session, driven from the browser over the same-origin
 * `/eve/v1/*` routes (withEve). Shared by the Assistant and the Agents
 * chat — the transport, resume, park handling and 409 recovery used to be
 * duplicated in both components and had drifted.
 *
 * Contract (eve 0.83):
 *   - sessions are addressed by durable id; follow-ups are
 *     `POST /eve/v1/session/:id` with EXACTLY ONE of `message` or
 *     `inputResponses`;
 *   - the NDJSON stream replays from index 0 on every attach, so the
 *     transcript is rebuilt from the event log each time (resume is free);
 *   - a question/approval holds the turn open (`turn.waiting {on:"input"}`);
 *     answering it through `respond()` resumes the SAME turn;
 *   - `409` on a follow-up means the session expired, was reset, or was
 *     built by an older runtime — start a fresh one, never fail the chat.
 */

export type EveSessionState = { id: string } | null;

export type UseEveSessionOptions = {
  /** Request headers (property / bot / agent / project selection). */
  headers: () => Record<string, string>;
  /** Saved session to resume on mount, if any. */
  initialSessionId?: string | null;
  /** Transform the first message of a NEW session (e.g. prepend a now-line). */
  frameFirstMessage?: (text: string) => string;
  /** Called after each completed turn with the live session id. */
  onTurn?: (info: { sessionId: string; isFirstTurn: boolean; message: string }) => void;
  /** Called when a turn or the session fails (toast, etc.). */
  onError?: (message: string) => void;
  /** Idle window (ms) after the FIRST chunk on resume. Default 2000. */
  resumeIdleMs?: number;
  /** Retries for the resume read (dev proxies 503 while compiling). Default 4. */
  resumeAttempts?: number;
};

export type UseEveSession = {
  items: TranscriptItem[];
  /** Open questions/approvals the person must answer. */
  pending: InputRequest[];
  busy: boolean;
  resuming: boolean;
  sessionId: string | null;
  send: (text: string) => Promise<void>;
  /** Answer a parked request by id (option or free text). */
  respond: (
    requestId: string,
    answer: { optionId?: string; text?: string },
  ) => Promise<void>;
  /** Cancel the in-flight turn. */
  cancel: () => Promise<void>;
  /** Forget the current session (next send creates a new one). */
  reset: () => void;
};

export function useEveSession(options: UseEveSessionOptions): UseEveSession {
  const {
    headers,
    initialSessionId = null,
    frameFirstMessage,
    onTurn,
    onError,
    resumeIdleMs = 2000,
    resumeAttempts = 4,
  } = options;

  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [pending, setPending] = useState<InputRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(Boolean(initialSessionId));
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);

  const sessionRef = useRef<string | null>(initialSessionId);
  // User turns the session is known to hold, kept current by every replay —
  // a follow-up must consume until the park FOLLOWING its own turn, not the
  // first park it sees (which is the PREVIOUS turn's).
  const turnsRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);

  const publish = useCallback((next: TranscriptItem[]) => {
    const copy = [...next];
    setItems(copy);
    setPending(pendingInputRequests(copy));
  }, []);

  const consumeStream = useCallback(
    async (id: string, expectedTurns: number | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(`/eve/v1/session/${id}/stream`, {
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
        onWaiting: () => {
          if (expectedTurns !== null && userTurns >= expectedTurns) controller.abort();
        },
        onFailed: () => {
          onError?.("That turn failed — try sending it again.");
          controller.abort();
        },
      });

      let sawData = false;
      try {
        for (;;) {
          // Resume (expectedTurns === null) races an idle window: a parked
          // session's replay simply goes quiet, with no further park event
          // to stop on. The FIRST chunk gets a long window — the eve proxy
          // can still be warming up right after a page load.
          const chunk =
            expectedTurns === null
              ? await Promise.race([
                  reader.read(),
                  new Promise<{ done: true; value?: undefined }>((resolve) =>
                    setTimeout(
                      () => resolve({ done: true }),
                      sawData ? resumeIdleMs : 20_000,
                    ),
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
          publish(reducer.items);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      } finally {
        reader.cancel().catch(() => {});
        publish(reducer.items);
        turnsRef.current = Math.max(turnsRef.current, userTurns);
      }
    },
    [headers, onError, publish, resumeIdleMs],
  );

  /** POST a delivery to the current session (or create one), with the 409
   * fresh-session fallback. Returns the live session id. */
  const deliver = useCallback(
    async (
      body: { message: string } | { inputResponses: Array<Record<string, unknown>> },
      firstMessage: string | null,
    ): Promise<{ sessionId: string; isFirstTurn: boolean }> => {
      const current = sessionRef.current;
      let isFollowUp = Boolean(current);
      let response = await fetch(
        isFollowUp ? `/eve/v1/session/${current}` : "/eve/v1/session",
        { method: "POST", headers: headers(), body: JSON.stringify(body) },
      );
      if (isFollowUp && response.status === 409 && "message" in body) {
        // Expired / reset / stranded — continue in a fresh session.
        isFollowUp = false;
        sessionRef.current = null;
        turnsRef.current = 0;
        const framed = frameFirstMessage ? frameFirstMessage(body.message) : body.message;
        response = await fetch("/eve/v1/session", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ message: firstMessage ?? framed }),
        });
      }
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "You're not authorized for this workspace."
            : `The agent runtime returned ${response.status}.`,
        );
      }
      const payload = (await response.json()) as { sessionId?: string };
      const id = payload.sessionId ?? (isFollowUp ? current : null);
      if (!id) throw new Error("No session id came back.");
      sessionRef.current = id;
      setSessionId(id);
      return { sessionId: id, isFirstTurn: !isFollowUp };
    },
    [frameFirstMessage, headers],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      // Optimistic echo — the replay replaces it a beat later.
      setItems((prev) => [...prev, { kind: "user", text: message }]);
      try {
        const isNew = !sessionRef.current;
        const outbound = isNew && frameFirstMessage ? frameFirstMessage(message) : message;
        const { sessionId: id, isFirstTurn } = await deliver({ message: outbound }, outbound);
        if (isFirstTurn) turnsRef.current = 0;
        await consumeStream(id, turnsRef.current + 1);
        onTurn?.({ sessionId: id, isFirstTurn, message });
      } catch (error) {
        onError?.(error instanceof Error ? error.message : "Couldn't reach the agent");
      } finally {
        setBusy(false);
      }
    },
    [busy, consumeStream, deliver, frameFirstMessage, onError, onTurn],
  );

  const respond = useCallback(
    async (requestId: string, answer: { optionId?: string; text?: string }) => {
      const current = sessionRef.current;
      if (!current || busy) return;
      setBusy(true);
      try {
        await deliver({ inputResponses: [{ requestId, ...answer }] }, null);
        // The answer resumes the SAME turn (eve ≥ 0.70): the next park is
        // still this turn's — consume until it.
        await consumeStream(current, turnsRef.current);
        onTurn?.({ sessionId: current, isFirstTurn: false, message: answer.optionId ?? answer.text ?? "" });
      } catch (error) {
        onError?.(error instanceof Error ? error.message : "Couldn't deliver your answer");
      } finally {
        setBusy(false);
      }
    },
    [busy, consumeStream, deliver, onError, onTurn],
  );

  const cancel = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    await fetch(`/eve/v1/session/${current}/cancel`, {
      method: "POST",
      headers: headers(),
      body: "{}",
    }).catch(() => null);
    abortRef.current?.abort();
    setBusy(false);
  }, [headers]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = null;
    turnsRef.current = 0;
    setSessionId(null);
    publish([]);
  }, [publish]);

  // Resume a saved conversation on mount. RETRIED, and the stored session is
  // NEVER discarded on a read failure: failing to DISPLAY history is
  // recoverable; failing to CONTINUE it is not.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const id = sessionRef.current;
    if (!id) {
      setResuming(false);
      return;
    }
    void (async () => {
      try {
        for (let attempt = 0; attempt < resumeAttempts; attempt += 1) {
          try {
            await consumeStream(id, null);
            return;
          } catch {
            if (attempt === resumeAttempts - 1) return;
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      } finally {
        setResuming(false);
      }
    })();
  }, [consumeStream, resumeAttempts]);

  // Abort the in-flight read when the owner unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { items, pending, busy, resuming, sessionId, send, respond, cancel, reset };
}
