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

export type ChannelAiMode = "mention" | "auto" | "always";
export type ChannelAiSensitivity = "conservative" | "balanced" | "eager";

export type ChannelAiSettings = {
  mode: ChannelAiMode;
  /** Only meaningful when mode === "auto"; ignored otherwise. */
  sensitivity?: ChannelAiSensitivity;
};

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
