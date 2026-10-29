"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * gr8r-studio's per-device appearance prefs (Settings → Appearance): accent,
 * sidebar density, task density and motion. gr8r keeps them on `:root`
 * (`:root[data-accent=…]`); our generated gr8r.css scopes every selector to
 * `.g8`, so the attributes go on the shell's ROOT `.g8` element
 * (`.g8[data-accent='teal']`, `.g8[data-density='compact']`…).
 *
 * Theme (light / dark / system) is NOT here — it is next-themes' `.dark` on
 * <html>, which already persists per device.
 *
 * Mount `<AppearancePrefs />` once inside the property shell so the prefs
 * apply on every page; the Settings page also renders it, so changes there
 * apply live either way. Several instances are harmless (same values).
 */

export const ACCENTS = ["indigo", "blue", "violet", "teal", "rose", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
export type Density = "comfortable" | "compact";
export type Motion = "system" | "reduce";

export type AppearancePrefsValue = {
  accent: Accent;
  /** gr8r `data-side` — sidebar row height. */
  side: Density;
  /** gr8r `data-density` — list row height + board card padding. */
  density: Density;
  motion: Motion;
};

const KEY = "hotelclaw:appearance:v1";
export const DEFAULT_APPEARANCE: AppearancePrefsValue = {
  accent: "indigo",
  side: "comfortable",
  density: "comfortable",
  motion: "system",
};

let cached: AppearancePrefsValue | null = null;
const listeners = new Set<() => void>();

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function read(): AppearancePrefsValue {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AppearancePrefsValue>;
      cached = {
        accent: pick(p.accent, ACCENTS, "indigo"),
        side: pick(p.side, ["comfortable", "compact"] as const, "comfortable"),
        density: pick(p.density, ["comfortable", "compact"] as const, "comfortable"),
        motion: pick(p.motion, ["system", "reduce"] as const, "system"),
      };
      return cached;
    }
  } catch {
    // Storage unavailable or malformed — defaults.
  }
  cached = DEFAULT_APPEARANCE;
  return cached;
}

function write(next: AppearancePrefsValue) {
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

const serverSnapshot = () => DEFAULT_APPEARANCE;

export function useAppearancePrefs() {
  const prefs = useSyncExternalStore(subscribe, read, serverSnapshot);
  const set = useCallback(
    <K extends keyof AppearancePrefsValue>(key: K, value: AppearancePrefsValue[K]) => {
      write({ ...read(), [key]: value });
    },
    [],
  );
  const reset = useCallback(() => write(DEFAULT_APPEARANCE), []);
  return { prefs, set, reset };
}

/**
 * The outermost `.g8` element(s) — the shell root. Nested `.g8` islands (the
 * accent swatches re-declare the token set to preview each accent) carry
 * their own `data-accent` and must not be overwritten.
 */
function rootG8Elements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".g8")).filter(
    (el) => !el.parentElement?.closest(".g8"),
  );
}

function setAttr(el: HTMLElement, name: string, value: string | null) {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

export function applyAppearance(prefs: AppearancePrefsValue) {
  for (const el of rootG8Elements()) {
    // Defaults are the bare token set — no attribute, exactly like gr8r.
    setAttr(el, "data-accent", prefs.accent === "indigo" ? null : prefs.accent);
    setAttr(el, "data-side", prefs.side === "compact" ? "compact" : null);
    setAttr(el, "data-density", prefs.density === "compact" ? "compact" : null);
    setAttr(el, "data-motion", prefs.motion === "reduce" ? "reduce" : null);
  }
}

/** Applies the stored appearance prefs to the shell root. Renders nothing. */
export function AppearancePrefs() {
  const { prefs } = useAppearancePrefs();
  useEffect(() => {
    applyAppearance(prefs);
  }, [prefs]);
  return null;
}
