"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseTurnStep, TURN_STEP_COLUMNS, type TurnStep } from "@hotelclaw/chat-ui/turn";

/**
 * The channel bot's turn trace — the client half of migration 0113.
 *
 * The SHAPES live in `@hotelclaw/chat-ui/turn` (shared with mobile and the
 * runtime); this file owns the web's fetch + cache. A delivered reply
 * carries three small custom fields: `eve_turn` (the nonce), `eve_steps`
 * (label + time per step, enough for the summary line) and, when the turn
 * parked, `eve_requests` + `eve_usage`. The full structured rows (tool
 * inputs/outputs, task results, reasoning text) live in
 * `channel_bot_activity` and are fetched by nonce only when a reader opens
 * the trace — Stream caps a message near 5KB, Postgres does not. The live
 * thinking row reads the same rows over Realtime.
 */

export type {
  MessageRequest,
  ParkRequest,
  SummaryStep,
  TurnStep,
  TurnStepKind,
  TurnStepStatus,
  TurnUsage,
} from "@hotelclaw/chat-ui/turn";
export {
  isMessageRequests,
  isSummarySteps,
  isTurnUsage,
  parseTurnStep,
  TURN_STEP_COLUMNS,
  upsertTurnStep,
} from "@hotelclaw/chat-ui/turn";

// One fetch per nonce per page — a channel with fifty bot replies must not
// fire fifty queries on scroll, and a reader re-opening a trace gets the
// cached rows. A tiny external store (useSyncExternalStore) rather than
// effect-driven state: the fetch is kicked from the effect, the result lands
// in the store, subscribers re-render.
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
  void createClient()
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
