import "server-only";
/**
 * Abuse + budget guardrails for the public guest-chat API.
 *
 * Rate limiting uses Upstash Redis (INCR + EXPIRE fixed windows — same
 * fail-soft singleton discipline as lib/stream/ai-turn-history.ts). When
 * Redis isn't configured we fail open on rate limits (dev-friendly) but the
 * daily budget still holds: its source of truth is Postgres
 * (`chatbot_usage_daily`), checked before every generation.
 */
import { Redis } from "@upstash/redis";
import { createServiceClient } from "@/lib/supabase/server";

let _client: Redis | null = null;
let _warned = false;

function getRedis(): Redis | null {
  if (_client) return _client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!_warned) {
      console.warn(
        "[chatbot-limits] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — guest chat rate limiting is disabled (daily budgets still enforced via Postgres).",
      );
      _warned = true;
    }
    return null;
  }
  _client = new Redis({ url, token });
  return _client;
}

/** Fixed-window counter. Returns false when the caller is over the limit. */
async function withinLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // fail open — budget check still applies
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= limit;
  } catch (err) {
    console.error("[chatbot-limits] redis error", err);
    return true;
  }
}

export type RateLimitVerdict = { ok: true } | { ok: false; reason: string };

/** Generic fixed-window limiter for other public surfaces (booking page). */
export async function publicRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  return withinLimit(`pub-rl:${key}`, limit, windowSeconds);
}

/**
 * Layered per-minute limits: conversation (one chatty guest), IP (one device
 * hammering many conversations), bot (property-wide surge cap).
 */
export async function checkGuestRateLimits(args: {
  conversationId: string;
  chatbotId: string;
  ip: string | null;
}): Promise<RateLimitVerdict> {
  const [convOk, ipOk, botOk] = await Promise.all([
    withinLimit(`cb-rl:conv:${args.conversationId}`, 10, 60),
    args.ip ? withinLimit(`cb-rl:ip:${args.ip}`, 30, 60) : Promise.resolve(true),
    withinLimit(`cb-rl:bot:${args.chatbotId}`, 300, 60),
  ]);
  if (!convOk) return { ok: false, reason: "You're sending messages too quickly — give me a moment." };
  if (!ipOk || !botOk) return { ok: false, reason: "We're getting a lot of messages right now — please try again in a minute." };
  return { ok: true };
}

export type BudgetVerdict =
  | { ok: true; used: number; cap: number }
  | { ok: false; used: number; cap: number };

/** Today's bot-reply count vs the bot's daily cap (Postgres is the truth). */
export async function checkDailyBudget(args: {
  chatbotId: string;
  dailyCap: number;
}): Promise<BudgetVerdict> {
  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("chatbot_usage_daily")
    .select("messages")
    .eq("chatbot_id", args.chatbotId)
    .eq("day", today)
    .maybeSingle();
  const used = data?.messages ?? 0;
  return { ok: used < args.dailyCap, used, cap: args.dailyCap };
}

/** Atomic post-generation usage increment (RPC from migration 0061). */
export async function recordUsage(args: {
  chatbotId: string;
  propertyId: string;
  tokens: number;
}): Promise<void> {
  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.rpc("increment_chatbot_usage", {
    p_chatbot_id: args.chatbotId,
    p_property_id: args.propertyId,
    p_day: today,
    p_messages: 1,
    p_tokens: args.tokens,
  });
  if (error) console.error("[chatbot-limits] usage increment failed", error.message);
}
