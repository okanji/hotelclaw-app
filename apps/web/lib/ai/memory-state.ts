import "server-only";
/**
 * In-memory `StateAdapter` for the Vercel `chat` package.
 *
 * The chat README example imports `createMemoryState` from
 * `@chat-adapter/state-memory`, but that package is not published yet (the
 * docstring lives in `chat/dist/index.d.ts:2678` as the only mention of the
 * factory). We supply our own minimal implementation so the comment bot can
 * boot in dev without a Redis/Upstash backend.
 *
 * Production caveat: this state lives on a single Node process. With multiple
 * server instances or a serverless runtime, locks won't coordinate and queue
 * messages may be dropped when one instance is recycled. Swap for a Redis or
 * Upstash-backed adapter before relying on this in production.
 */
import { randomUUID } from "node:crypto";
import type { Lock, QueueEntry, StateAdapter } from "chat";

type ValueEntry = { value: unknown; expiresAt: number | null };
type ListEntry = { value: unknown; expiresAt: number | null };

function isExpired(expiresAt: number | null): boolean {
  return expiresAt !== null && expiresAt <= Date.now();
}

function deadline(ttlMs?: number): number | null {
  return typeof ttlMs === "number" && ttlMs > 0 ? Date.now() + ttlMs : null;
}

class MemoryStateAdapter implements StateAdapter {
  private kv = new Map<string, ValueEntry>();
  private lists = new Map<string, ListEntry[]>();
  private queues = new Map<string, QueueEntry[]>();
  private subs = new Set<string>();
  private locks = new Map<string, { token: string; expiresAt: number }>();

  async connect(): Promise<void> {
    // No-op for in-memory.
  }

  async disconnect(): Promise<void> {
    this.kv.clear();
    this.lists.clear();
    this.queues.clear();
    this.subs.clear();
    this.locks.clear();
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (isExpired(entry.expiresAt)) {
      this.kv.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.kv.set(key, { value, expiresAt: deadline(ttlMs) });
  }

  async delete(key: string): Promise<void> {
    this.kv.delete(key);
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<boolean> {
    const existing = this.kv.get(key);
    if (existing && !isExpired(existing.expiresAt)) return false;
    this.kv.set(key, { value, expiresAt: deadline(ttlMs) });
    return true;
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const list = this.lists.get(key);
    if (!list) return [];
    const now = Date.now();
    const live = list.filter(
      (e) => e.expiresAt === null || e.expiresAt > now,
    );
    if (live.length === 0) {
      this.lists.delete(key);
      return [];
    }
    if (live.length !== list.length) this.lists.set(key, live);
    return live.map((e) => e.value as T);
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number },
  ): Promise<void> {
    const list = this.lists.get(key) ?? [];
    const expiresAt = deadline(options?.ttlMs);
    list.push({ value, expiresAt });
    if (options?.maxLength && list.length > options.maxLength) {
      list.splice(0, list.length - options.maxLength);
    }
    if (expiresAt !== null) {
      for (const entry of list) entry.expiresAt = expiresAt;
    }
    this.lists.set(key, list);
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number,
  ): Promise<number> {
    const queue = this.queues.get(threadId) ?? [];
    queue.push(entry);
    if (queue.length > maxSize) {
      queue.splice(0, queue.length - maxSize);
    }
    this.queues.set(threadId, queue);
    return queue.length;
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    const queue = this.queues.get(threadId);
    if (!queue || queue.length === 0) return null;
    const next = queue.shift() ?? null;
    if (queue.length === 0) this.queues.delete(threadId);
    return next;
  }

  async queueDepth(threadId: string): Promise<number> {
    return this.queues.get(threadId)?.length ?? 0;
  }

  async subscribe(threadId: string): Promise<void> {
    this.subs.add(threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.subs.delete(threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return this.subs.has(threadId);
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const existing = this.locks.get(threadId);
    const now = Date.now();
    if (existing && existing.expiresAt > now) return null;
    const token = randomUUID();
    const expiresAt = now + ttlMs;
    this.locks.set(threadId, { token, expiresAt });
    return { threadId, expiresAt, token } as unknown as Lock;
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const lk = lock as unknown as {
      threadId: string;
      token: string;
      expiresAt: number;
    };
    const current = this.locks.get(lk.threadId);
    if (!current || current.token !== lk.token) return false;
    current.expiresAt = Date.now() + ttlMs;
    this.locks.set(lk.threadId, current);
    lk.expiresAt = current.expiresAt;
    return true;
  }

  async releaseLock(lock: Lock): Promise<void> {
    const lk = lock as unknown as { threadId: string; token: string };
    const current = this.locks.get(lk.threadId);
    if (current && current.token === lk.token) {
      this.locks.delete(lk.threadId);
    }
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.locks.delete(threadId);
  }
}

let _instance: MemoryStateAdapter | null = null;

export function createMemoryState(): StateAdapter {
  if (!_instance) _instance = new MemoryStateAdapter();
  return _instance;
}
