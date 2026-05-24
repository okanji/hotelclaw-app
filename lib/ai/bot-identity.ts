/**
 * Bot identity constants — client-safe.
 *
 * `lib/stream/ai-adapter.ts` and `lib/ai/bot-scaffold.ts` are `server-only`
 * but the chat info panel + Liveblocks mention resolvers need to identify
 * the bot on the client too. Server may override via env; the client
 * always uses the default. Keep these in sync if you change the env defaults
 * in `.env.example`.
 */

export const BOT_USER_ID = "hotelclaw-ai";
export const BOT_DISPLAY_NAME = "Hotelclaw";
