"use client";

import { useCallback, useSyncExternalStore } from "react";
import { NAV_APP_BY_ID, type NavAppId } from "./nav-apps";

/**
 * The person's sidebar layout: which apps are pinned (and their order), and
 * which lower groups show. One external store so the sidebar, the More
 * launcher and the Customize dialog never disagree mid-edit.
 *
 * Per device (localStorage), like the rest of the sidebar's open/closed
 * state. `pins: null` means "never customized" — the caller's role-aware
 * default applies, so a manager promoted later still gets Insights.
 */
export type NavSectionId = "favorites" | "teams" | "projects";

export type NavPrefs = {
  pins: NavAppId[] | null;
  hidden: NavSectionId[];
};

const KEY = "hotelclaw:nav-prefs:v1";
const EMPTY: NavPrefs = { pins: null, hidden: [] };

let cached: NavPrefs | null = null;
const listeners = new Set<() => void>();

function read(): NavPrefs {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NavPrefs>;
      cached = {
        // Drop ids a newer build no longer knows.
        pins: Array.isArray(parsed.pins)
          ? parsed.pins.filter((id): id is NavAppId => NAV_APP_BY_ID.has(id as NavAppId))
          : null,
        hidden: Array.isArray(parsed.hidden)
          ? parsed.hidden.filter((s): s is NavSectionId =>
              ["favorites", "teams", "projects"].includes(s),
            )
          : [],
      };
      return cached;
    }
  } catch {
    // Storage unavailable or malformed — defaults.
  }
  cached = EMPTY;
  return cached;
}

function write(next: NavPrefs) {
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Preference only.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab customized its sidebar.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cached = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useNavPrefs(defaults: NavAppId[]) {
  const prefs = useSyncExternalStore(subscribe, read, () => EMPTY);
  const pins = prefs.pins ?? defaults;

  const setPins = useCallback((next: NavAppId[]) => {
    write({ ...read(), pins: next });
  }, []);

  const togglePin = useCallback(
    (id: NavAppId) => {
      const current = read().pins ?? defaults;
      setPins(current.includes(id) ? current.filter((p) => p !== id) : [...current, id]);
    },
    [defaults, setPins],
  );

  const movePin = useCallback(
    (id: NavAppId, delta: -1 | 1) => {
      const current = [...(read().pins ?? defaults)];
      const i = current.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= current.length) return;
      [current[i], current[j]] = [current[j], current[i]];
      setPins(current);
    },
    [defaults, setPins],
  );

  const toggleSection = useCallback((id: NavSectionId) => {
    const current = read();
    write({
      ...current,
      hidden: current.hidden.includes(id)
        ? current.hidden.filter((s) => s !== id)
        : [...current.hidden, id],
    });
  }, []);

  const reset = useCallback(() => write(EMPTY), []);

  return {
    pins,
    customized: prefs.pins !== null || prefs.hidden.length > 0,
    hidden: prefs.hidden,
    togglePin,
    movePin,
    toggleSection,
    reset,
  };
}
