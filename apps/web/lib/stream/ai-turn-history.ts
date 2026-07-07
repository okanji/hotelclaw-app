import "server-only";
/**
 * Per-engaged-conversation tool history for the in-channel AI bot.
 *
 * Stores each bot turn's `response.messages` (Vercel AI SDK transcript —
 * includes tool calls and tool results) in Upstash Redis so subsequent
 * turns in the same engaged thread can replay it. The bot can then build
 * on its earlier tool work ("you said 5 tasks were blocked — which is
 * most urgent?") without re-querying.
 *
 * Why Redis (not a Supabase table):
 *   • Purpose-built for ephemeral cache state — engaged conversations
 *     live ~minutes to hours, not forever.
 *   • TTL handles cleanup automatically: if the engagement classifier's
 *     `disengage` step is ever missed (bug, crash, server restart), the
 *     key expires on its own. We don't accumulate stale rows.
 *   • Faster than a SQL round-trip (~10ms vs ~50-200ms).
 *   • No migration / table to maintain.
 *
 * Lifecycle is tied to the engaged-mode state machine:
 *   • engaged-mode reply → `saveTurn(...)` (RPUSH + EXPIRE refresh)
 *   • engaged-mode follow-up → `loadTurns(...)` (LRANGE last N)
 *   • disengage / sign-off → `clearThread(...)` (DEL)
 *   • abandoned (no disengage fired) → TTL expires after 24h
 *
 * Only engaged mode persists. Mention/Auto/Always remain text-only-history
 * (one-shot turns, re-call tools each time for freshness).
 *
 * Env (server-only):
 *   UPSTASH_REDIS_REST_URL    — REST endpoint from the Upstash console.
 *   UPSTASH_REDIS_REST_TOKEN  — REST token (Read+Write, not the read-only).
 *
 * When env is missing, all calls become no-ops (with a one-time warning).
 * The bot still works — it just loses cross-turn memory in engaged mode.
 */
import { Redis } from "@upstash/redis";
import type { ModelMessage } from "ai";

/**
 * Safety cap on turns replayed per generation. Backstop only — normal
 * conversations end when the engagement classifier returns "disengage"
 * (which deletes the key entirely). This guards against a runaway long
 * engaged thread blowing the model's context window or billing budget.
 */
const MAX_TURNS_REPLAYED = 20;

/**
 * TTL applied to the list on every save. 24h is generous — engaged
 * conversations rarely run that long, but if `clearThread` ever fails
 * (server restart between disengage decision and the DEL), the key
 * cleans itself up the next day. Refreshed on every save so active
 * conversations keep extending the deadline.
 */
const TTL_SECONDS = 24 * 60 * 60;

function keyFor(channelId: string, threadKey: string): string {
  return `ai-turns:${channelId}:${threadKey}`;
}

// Lazy singleton — avoids constructing the client at module load (which
// would throw in environments without the env vars set, breaking the build).
let _client: Redis | null = null;
let _warned = false;

function getClient(): Redis | null {
  if (_client) return _client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!_warned) {
      console.warn(
        "[ai-turn-history] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — engaged-mode conversations will work but won't remember tool history across turns.",
      );
      _warned = true;
    }
    return null;
  }
  _client = new Redis({ url, token });
  return _client;
}

/**
 * Append a turn (one bot generation's `response.messages`) for the engaged
 * thread. Refreshes the TTL on the key so active conversations stay alive.
 */
export async function saveTurn(
  channelId: string,
  threadKey: string,
  modelMessages: ModelMessage[],
): Promise<void> {
  if (modelMessages.length === 0) return;
  const redis = getClient();
  if (!redis) return;

  const key = keyFor(channelId, threadKey);
  try {
    // Pipeline: append + refresh TTL in one round-trip.
    await redis
      .pipeline()
      .rpush(key, JSON.stringify(modelMessages))
      .expire(key, TTL_SECONDS)
      .exec();
  } catch (err) {
    console.error("[ai-turn-history] saveTurn failed", err);
  }
}

/**
 * Load prior turns for this engaged thread in chronological order, capped
 * to the most recent `MAX_TURNS_REPLAYED` to bound input token cost.
 * Returns the concatenated `ModelMessage[]` ready to prepend to the next
 * generateText call.
 */
export async function loadTurns(
  channelId: string,
  threadKey: string,
): Promise<ModelMessage[]> {
  const redis = getClient();
  if (!redis) return [];

  const key = keyFor(channelId, threadKey);
  let raw: unknown[];
  try {
    // LRANGE with -N to -1 returns the last N items in chronological order.
    raw = await redis.lrange(key, -MAX_TURNS_REPLAYED, -1);
  } catch (err) {
    console.error("[ai-turn-history] loadTurns failed", err);
    return [];
  }

  // Flatten: each list entry is one bot turn's full transcript
  // (ModelMessage[]). Concatenating in chronological order reconstructs
  // the conversation as the model would have seen it growing across turns.
  // Upstash auto-deserializes JSON strings, so entries arrive as either
  // already-parsed arrays or strings depending on SDK version — handle both.
  const flat: ModelMessage[] = [];
  for (const entry of raw) {
    const parsed = typeof entry === "string" ? safeParse(entry) : entry;
    if (Array.isArray(parsed)) {
      for (const msg of parsed) flat.push(msg as ModelMessage);
    }
  }
  return flat;
}

/**
 * Wipe all stored turns for this thread. Called when the engagement
 * classifier returns `disengage` (the bot signs off and the conversation
 * is considered ended). The TTL backstop will also clean this up after
 * 24h if the explicit delete is missed.
 */
export async function clearThread(
  channelId: string,
  threadKey: string,
): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(keyFor(channelId, threadKey));
  } catch (err) {
    console.error("[ai-turn-history] clearThread failed", err);
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
