import "server-only";
/**
 * Per-channel/per-thread single-flight lock for AI generation.
 *
 * Problem: when N messages arrive within a single bot generation window
 * (which takes 2-5s for Sonnet replies), N independent webhooks each fire
 * their own generateText. Each generation queries channel history, sees
 * all N messages, and addresses all of them. Result: N near-identical
 * overlapping replies for one burst.
 *
 * This module is one half of the fix — the lock. The other half is the
 * "coalesce loop" inside generateAndPostReply: after generateText
 * finishes, re-query the channel; if new non-bot messages arrived since
 * the query that fed the generation, throw it away and re-run with the
 * fresh history. That way the single reply that finally posts addresses
 * every message in the burst, and any subsequent webhooks that arrived
 * during the gen simply failed to acquire the lock and were absorbed.
 *
 * No debounce: single-message replies pay zero added latency. The lock
 * is acquired instantly; if there's no burst, gen + re-check are fast
 * and we post. Bursts trade an extra Sonnet call for a cohesive reply.
 *
 * Backed by Upstash Redis (SET NX EX). When Redis env is missing, the
 * lock is a no-op (fail-open) so the bot still works in dev environments
 * without Redis. Same pattern as ai-turn-history.ts.
 */
import { Redis } from "@upstash/redis";

/**
 * Lock TTL — generous upper bound on a single coalesce-loop iteration
 * (gen + tools + post-back), times the max retry count. If a process
 * crashes holding the lock, the key auto-expires and future webhooks
 * recover. Tune up if you observe lock-held errors with legitimate long
 * generations; tune down if stuck-lock incidents become common.
 */
const LOCK_TTL_SECONDS = 60;

let _client: Redis | null = null;
let _warned = false;

function getClient(): Redis | null {
  if (_client) return _client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!_warned) {
      console.warn(
        "[ai-generation-lock] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — generation lock disabled. Bursts of rapid messages will produce duplicate replies.",
      );
      _warned = true;
    }
    return null;
  }
  _client = new Redis({ url, token });
  return _client;
}

function keyFor(channelId: string, threadKey: string): string {
  return `ai-gen-lock:${channelId}:${threadKey}`;
}

/**
 * Try to acquire the generation lock. Returns true on success, false if
 * another generation is already in flight for this channel+thread.
 * When Redis is unavailable, returns true (fail-open).
 */
export async function tryAcquireGenerationLock(
  channelId: string,
  threadKey: string,
): Promise<boolean> {
  const redis = getClient();
  if (!redis) return true;
  try {
    const result = await redis.set(keyFor(channelId, threadKey), "1", {
      nx: true,
      ex: LOCK_TTL_SECONDS,
    });
    return result === "OK";
  } catch (err) {
    console.error("[ai-generation-lock] tryAcquire failed", err);
    return true; // fail-open on Redis errors
  }
}

export async function releaseGenerationLock(
  channelId: string,
  threadKey: string,
): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(keyFor(channelId, threadKey));
  } catch (err) {
    console.error("[ai-generation-lock] release failed", err);
  }
}
