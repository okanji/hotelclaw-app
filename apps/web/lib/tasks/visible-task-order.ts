"use client";

import { useSyncExternalStore } from "react";

/**
 * The task ids the board / list is SHOWING right now, in on-screen order
 * (toolbar filters + sort applied, status columns in order). Published by
 * the task views, read by the task detail header so prev/next (`k`/`j`)
 * follows what the user was looking at — see `resolveTaskSequence`.
 *
 * A module-level store (instant across soft navigations) mirrored into
 * sessionStorage per property, so a reload of the task page keeps the
 * sequence. Last publisher wins: the most recently viewed list is the one
 * the user came from.
 */

const KEY = (propertyId: string) => `hc:visible-task-order:${propertyId}`;
const EMPTY: readonly string[] = [];

const memory = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function publishVisibleTaskOrder(
  propertyId: string,
  ids: readonly string[],
): void {
  const prev = memory.get(propertyId);
  if (prev && sameIds(prev, ids)) return;
  const next = [...ids];
  memory.set(propertyId, next);
  try {
    sessionStorage.setItem(KEY(propertyId), JSON.stringify(next));
  } catch {
    // Private mode / quota — the in-memory copy still serves soft navs.
  }
  for (const l of listeners) l();
}

export function readVisibleTaskOrder(propertyId: string): readonly string[] {
  const hit = memory.get(propertyId);
  if (hit) return hit;
  try {
    const raw = sessionStorage.getItem(KEY(propertyId));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        memory.set(propertyId, parsed);
        return parsed;
      }
    }
  } catch {
    // Unavailable storage — fall through to board order.
  }
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe to the property's published order (empty on the server). */
export function useVisibleTaskOrder(propertyId: string): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => readVisibleTaskOrder(propertyId),
    () => EMPTY,
  );
}
