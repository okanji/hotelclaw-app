import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTranscriptReducer,
  pendingInputRequests,
  type InputRequest,
  type TranscriptItem,
} from "@hotelclaw/chat-ui/transcript";
import { EveError, eveCancel, eveDeliver, eveHeaders, eveStream } from "../lib/eve";

/**
 * One durable eve session from the phone — the mobile twin of
 * `apps/web/hooks/use-eve-session.ts` (same contract: session ids, replay
 * from index 0 rebuilt by the shared reducer, `inputResponses` to answer a
 * parked question/approval, 409 → fresh session). The transcript therefore
 * renders identically on both apps.
 */
export function useEveSession(options: {
  propertyId: string | null;
  /** x-hotelclaw-bot / -agent / -project selection. */
  extraHeaders?: Record<string, string>;
  initialSessionId?: string | null;
  frameFirstMessage?: (text: string) => string;
  onTurn?: (info: { sessionId: string; isFirstTurn: boolean; message: string }) => void;
  onError?: (message: string) => void;
}) {
  const { propertyId, extraHeaders, initialSessionId = null, frameFirstMessage, onTurn, onError } =
    options;
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [pending, setPending] = useState<InputRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(Boolean(initialSessionId));
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);

  const sessionRef = useRef<string | null>(initialSessionId);
  const turnsRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);
  // What the screen shows, for carrying it across a session swap (below).
  const itemsRef = useRef<TranscriptItem[]>([]);
  // Turns from an EARLIER session still shown above the current one. A 409
  // (expired / stranded) starts a fresh session whose replay holds only the
  // new turn — without this the whole conversation vanished on the swap.
  const prefixRef = useRef<TranscriptItem[]>([]);
  const extraRef = useRef(extraHeaders);
  useEffect(() => {
    extraRef.current = extraHeaders;
  }, [extraHeaders]);

  const headers = useCallback(async () => {
    if (!propertyId) throw new EveError(400, "No property selected");
    return eveHeaders(propertyId, extraRef.current);
  }, [propertyId]);

  const publish = useCallback((next: TranscriptItem[]) => {
    const copy = [...prefixRef.current, ...next];
    itemsRef.current = copy;
    setItems(copy);
    // Only the CURRENT session can answer a parked question.
    setPending(pendingInputRequests(next));
  }, []);

  const consume = useCallback(
    async (id: string, expectedTurns: number | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
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
      // The replay starts from index 0, so its first events hold only the
      // EARLIEST turns. Publishing those wiped the optimistic echo of the
      // message just sent and shrank the transcript to its first exchange,
      // then rebuilt it event by event — the prompt vanished, came back, and
      // the whole list flashed while scrollToEnd chased the collapsing
      // content. During a send/respond consume, hold the current items until
      // the replay has caught up to the turn being consumed (the web hook's
      // rule, which this port had missed).
      const caughtUp = () => expectedTurns === null || userTurns >= expectedTurns;
      try {
        for await (const event of eveStream(
          id,
          await headers(),
          controller.signal,
          expectedTurns === null ? 2000 : null,
        )) {
          if (event.type === "message.received") userTurns += 1;
          reducer.handle(event);
          if (caughtUp()) publish(reducer.items);
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (caughtUp()) publish(reducer.items);
        turnsRef.current = Math.max(turnsRef.current, userTurns);
      }
    },
    [headers, onError, publish],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      const shown = itemsRef.current;
      setItems((prev) => [...prev, { kind: "user", text: message }]);
      try {
        const h = await headers();
        const isNew = !sessionRef.current;
        const outbound = isNew && frameFirstMessage ? frameFirstMessage(message) : message;
        let isFirstTurn = isNew;
        let id: string;
        try {
          id = (await eveDeliver(sessionRef.current, h, { message: outbound })).sessionId;
        } catch (error) {
          if (!(error instanceof EveError && error.status === 409)) throw error;
          // Expired / reset — continue in a fresh session, keeping what is
          // already on screen above its turns.
          prefixRef.current = shown;
          isFirstTurn = true;
          turnsRef.current = 0;
          const framed = frameFirstMessage ? frameFirstMessage(message) : message;
          id = (await eveDeliver(null, h, { message: framed })).sessionId;
        }
        sessionRef.current = id;
        setSessionId(id);
        if (isFirstTurn) turnsRef.current = 0;
        await consume(id, turnsRef.current + 1);
        onTurn?.({ sessionId: id, isFirstTurn, message });
      } catch (error) {
        onError?.(error instanceof Error ? error.message : "Couldn't reach the assistant");
      } finally {
        setBusy(false);
      }
    },
    [busy, consume, frameFirstMessage, headers, onError, onTurn],
  );

  const respond = useCallback(
    async (requestId: string, answer: { optionId?: string; text?: string }) => {
      const current = sessionRef.current;
      if (!current || busy) return;
      setBusy(true);
      try {
        await eveDeliver(current, await headers(), {
          inputResponses: [{ requestId, ...answer }],
        });
        // The answer resumes the SAME turn — consume until its park.
        await consume(current, turnsRef.current);
        onTurn?.({ sessionId: current, isFirstTurn: false, message: answer.optionId ?? answer.text ?? "" });
      } catch (error) {
        onError?.(error instanceof Error ? error.message : "Couldn't deliver your answer");
      } finally {
        setBusy(false);
      }
    },
    [busy, consume, headers, onError, onTurn],
  );

  const cancel = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      await eveCancel(current, await headers());
    } finally {
      abortRef.current?.abort();
      setBusy(false);
    }
  }, [headers]);

  useEffect(() => {
    if (hydratedRef.current || !propertyId) return;
    hydratedRef.current = true;
    const id = sessionRef.current;
    if (!id) {
      setResuming(false);
      return;
    }
    void (async () => {
      try {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            await consume(id, null);
            return;
          } catch {
            if (attempt === 3) return;
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      } finally {
        setResuming(false);
      }
    })();
  }, [consume, propertyId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { items, pending, busy, resuming, sessionId, send, respond, cancel };
}
