import "server-only";
/**
 * Vercel Chat SDK + Liveblocks adapter scaffolding.
 *
 * This is intentionally a stub in stage 1 — the Vercel `chat` package requires
 * a `state: StateAdapter` and `userName` in addition to adapters, and we don't
 * want to ship a half-real bot we never call. The factory exists to lock in the
 * shape and the import paths so stage 2 only adds: state adapter, handlers,
 * and registration. See:
 *   https://liveblocks.io/blog/chat-sdk-adapter-for-liveblocks
 *   https://chat-sdk.dev/
 *
 * Stage 2 wiring (sketch):
 *
 *   import { Chat } from "chat";
 *   import { createLiveblocksAdapter } from "@liveblocks/chat-sdk-adapter";
 *   const bot = new Chat({
 *     userName: "hotelclaw",
 *     state: myStateAdapter,           // see chat-sdk docs for built-ins
 *     adapters: {
 *       liveblocks: createLiveblocksAdapter({
 *         apiKey: process.env.LIVEBLOCKS_SECRET_KEY!,
 *         webhookSecret: process.env.LIVEBLOCKS_WEBHOOK_SECRET!,
 *         botUserId: "__hotelclaw_bot__",
 *         botUserName: "Hotelclaw",
 *       }),
 *     },
 *   });
 *   bot.onNewMention(async (thread, message) => { ... });
 */

export type BotScaffold = {
  /** Marker so callers can assert "the bot scaffolding is loaded". */
  readonly stage: "scaffolding";
};

let _instance: BotScaffold | null = null;

export function getBotScaffold(): BotScaffold {
  if (!_instance) {
    _instance = { stage: "scaffolding" };
  }
  return _instance;
}
