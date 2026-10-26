import { useEffect, useSyncExternalStore } from "react";
import { parseTurnStep, TURN_STEP_COLUMNS, type TurnStep } from "@hotelclaw/chat-ui/turn";
import { supabase } from "./supabase";

/**
 * The channel bot's structured turn rows (`channel_bot_activity`, migration
 * 0113), fetched by turn nonce when a reader opens a reply's trace — the
 * phone twin of `apps/web/components/ai/agent-turn/turn-activity.ts`. The
 * shapes and the parser are the shared `@hotelclaw/chat-ui/turn`; this file
 * owns only the fetch + cache. One fetch per nonce per app session: a
 * channel with fifty bot replies must not fire fifty queries on scroll.
 */
type TurnStepsEntry = { steps: TurnStep[] | null; loading: boolean; failed: boolean };
const IDLE: TurnStepsEntry = { steps: null, loading: false, failed: false };
const entries = new Map<string, TurnStepsEntry>();
const listeners = new Set<() => void>();

function setEntry(key: string, entry: TurnStepsEntry) {
  entries.set(key, entry);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadTurnSteps(channelId: string, turnNonce: string): void {
  const key = `${channelId}:${turnNonce}`;
  const current = entries.get(key);
  if (current && (current.loading || current.steps)) return;
  setEntry(key, { steps: null, loading: true, failed: false });
  void supabase
    .from("channel_bot_activity")
    .select(TURN_STEP_COLUMNS)
    .eq("channel_id", channelId)
    .eq("turn_nonce", turnNonce)
    .order("created_at", { ascending: true })
    .limit(80)
    .then(({ data, error }) => {
      if (error) {
        setEntry(key, { steps: null, loading: false, failed: true });
        return;
      }
      const steps = ((data ?? []) as unknown as Record<string, unknown>[])
        .map((row) => parseTurnStep(row))
        .filter((s): s is TurnStep => s !== null);
      setEntry(key, { steps, loading: false, failed: false });
    });
}

/** Fetch a settled turn's rows once `enabled` (the reader opened the trace). */
export function useTurnSteps({
  channelId,
  turnNonce,
  enabled,
}: {
  channelId: string | null;
  turnNonce: string | null;
  enabled: boolean;
}): TurnStepsEntry {
  const key = channelId && turnNonce ? `${channelId}:${turnNonce}` : null;
  const entry = useSyncExternalStore(
    subscribe,
    () => (key ? (entries.get(key) ?? IDLE) : IDLE),
    () => IDLE,
  );

  useEffect(() => {
    if (!enabled || !channelId || !turnNonce) return;
    loadTurnSteps(channelId, turnNonce);
  }, [enabled, channelId, turnNonce]);

  return entry;
}
