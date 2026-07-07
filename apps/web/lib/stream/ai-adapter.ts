import "server-only";
import { BOT_DISPLAY_NAME, BOT_USER_ID } from "@/lib/ai/bot-identity";
import { getStreamServer, upsertStreamUser } from "./server";

/**
 * Channel-membership helpers for the in-channel AI bot.
 *
 * The bot itself doesn't run a long-lived process — it's webhook-driven:
 * Stream POSTs `message.new` to `/api/stream/webhook/message-new`, and the
 * handler there decides whether to reply (see `ai-reply.ts`). All this
 * module owns is the per-channel activation toggle:
 *
 *   - `addBotToChannel`     — make the bot a Stream member so the @-mention
 *                             autocomplete sees it and the webhook gate
 *                             ("is the bot a member?") opens.
 *   - `removeBotFromChannel` — deactivate.
 *   - `setChannelAiMode`    — flip the channel between "mention only" and
 *                             "always respond" via a Stream channel custom
 *                             field.
 *
 * Env vars (server-only):
 *   STREAM_BOT_USER_ID   — defaults to "hotelclaw-ai" (kept in sync with the
 *                          client-safe constant in `lib/ai/bot-identity.ts`).
 */

export type ChannelAiMode = "mention" | "auto" | "always" | "engaged";
export type ChannelAiSensitivity = "conservative" | "balanced" | "eager";

export type ChannelAiSettings = {
  mode: ChannelAiMode;
  /** Only meaningful when mode === "auto"; ignored otherwise. */
  sensitivity?: ChannelAiSensitivity;
};

/**
 * Synthetic "thread id" used in engagement state to represent the channel
 * top-level. Real Stream thread parents have UUID-shaped ids, so collision
 * is impossible.
 */
export const ROOT_THREAD_KEY = "_root";

/** Soft cap on simultaneously engaged threads per channel. */
const ENGAGED_THREADS_CAP = 10;
/** Soft cap on remembered "classifier already said no" thread keys. */
const SKIPPED_THREADS_CAP = 20;

export function getBotUserId(): string {
  return process.env.STREAM_BOT_USER_ID ?? BOT_USER_ID;
}

export async function addBotToChannel(
  channelId: string,
  channelType: "team" | "messaging" = "team",
) {
  const stream = getStreamServer();
  const botUserId = getBotUserId();
  await upsertStreamUser({ id: botUserId, name: BOT_DISPLAY_NAME });
  const channel = stream.channel(channelType, channelId);
  await channel.addMembers([botUserId]);
}

export async function removeBotFromChannel(
  channelId: string,
  channelType: "team" | "messaging" = "team",
) {
  const stream = getStreamServer();
  const channel = stream.channel(channelType, channelId);
  await channel.removeMembers([getBotUserId()]);
}

/**
 * Persist the per-channel AI settings (mode + sensitivity) as Stream channel
 * custom fields so the webhook can read them without an extra DB round-trip.
 * The webhook fetches the channel via `channel.query()` (which it already
 * does for membership checks) and reads `channel.data.ai_mode` and
 * `channel.data.ai_sensitivity`.
 */
export async function setChannelAiSettings(
  channelId: string,
  channelType: "team" | "messaging",
  settings: ChannelAiSettings,
) {
  const stream = getStreamServer();
  const channel = stream.channel(channelType, channelId);
  // `ai_mode` / `ai_sensitivity` are custom fields — Stream channel data is
  // open-shape but the typed `set` parameter only lists built-ins, so cast.
  const set: Record<string, unknown> = { ai_mode: settings.mode };
  if (settings.sensitivity) set.ai_sensitivity = settings.sensitivity;
  await channel.updatePartial({
    set: set as unknown as Record<string, unknown>,
  });
}

/**
 * @deprecated Use `setChannelAiSettings` instead. Kept as a thin wrapper for
 * any in-flight callers still passing only a mode.
 */
export async function setChannelAiMode(
  channelId: string,
  channelType: "team" | "messaging",
  mode: ChannelAiMode,
) {
  return setChannelAiSettings(channelId, channelType, { mode });
}

// ---------------------------------------------------------------------------
// Engaged-mode per-thread state
// ---------------------------------------------------------------------------
//
// State shape on the Stream channel (custom fields):
//   ai_engaged_threads: string[]   // currently engaged thread keys
//   ai_skipped_threads: string[]   // classifier already said no in this
//                                  // engagement session — don't re-evaluate
//                                  // until engagement clears
//
// Both are written via channel.updatePartial. Stream's atomic array ops are
// not consistently exposed in the SDK we have, so we use read-modify-write.
// The webhook only writes one of these at a time per message, and the rare
// race window is acceptable: the worst case is one extra Haiku call on the
// next message (we'd re-evaluate a threadKey that should have been in the
// skipped set).

export type ChannelEngagementState = {
  engaged: string[];
  skipped: string[];
};

export function readEngagementState(
  channelData: Record<string, unknown> | undefined,
): ChannelEngagementState {
  const engaged = sanitizeKeyArray(channelData?.["ai_engaged_threads"]);
  const skipped = sanitizeKeyArray(channelData?.["ai_skipped_threads"]);
  return { engaged, skipped };
}

function sanitizeKeyArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
}

async function writeEngagementState(
  channelId: string,
  channelType: "team" | "messaging",
  state: ChannelEngagementState,
): Promise<void> {
  const stream = getStreamServer();
  const channel = stream.channel(channelType, channelId);
  await channel.updatePartial({
    set: {
      ai_engaged_threads: state.engaged,
      ai_skipped_threads: state.skipped,
    } as unknown as Record<string, unknown>,
  });
}

/** Add `threadKey` to the engaged set; clear it from skipped. Caps the list. */
export async function engageThread(
  channelId: string,
  channelType: "team" | "messaging",
  current: ChannelEngagementState,
  threadKey: string,
): Promise<ChannelEngagementState> {
  if (current.engaged.includes(threadKey) && !current.skipped.includes(threadKey)) {
    return current;
  }
  const engaged = [
    ...current.engaged.filter((k) => k !== threadKey),
    threadKey,
  ].slice(-ENGAGED_THREADS_CAP);
  const skipped = current.skipped.filter((k) => k !== threadKey);
  const next = { engaged, skipped };
  await writeEngagementState(channelId, channelType, next);
  return next;
}

/**
 * Remove `threadKey` from engaged. If that empties the engaged set, also
 * clear `skipped` — those rejections were scoped to the engagement session
 * that just ended.
 */
export async function disengageThread(
  channelId: string,
  channelType: "team" | "messaging",
  current: ChannelEngagementState,
  threadKey: string,
): Promise<ChannelEngagementState> {
  const engaged = current.engaged.filter((k) => k !== threadKey);
  const skipped = engaged.length === 0 ? [] : current.skipped;
  const next = { engaged, skipped };
  await writeEngagementState(channelId, channelType, next);
  return next;
}

/** Mark `threadKey` as classifier-rejected so we don't re-evaluate it. */
export async function markSpinoffSkipped(
  channelId: string,
  channelType: "team" | "messaging",
  current: ChannelEngagementState,
  threadKey: string,
): Promise<ChannelEngagementState> {
  if (current.skipped.includes(threadKey)) return current;
  const skipped = [
    ...current.skipped.filter((k) => k !== threadKey),
    threadKey,
  ].slice(-SKIPPED_THREADS_CAP);
  const next = { engaged: current.engaged, skipped };
  await writeEngagementState(channelId, channelType, next);
  return next;
}
