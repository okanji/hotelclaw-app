"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CalendarView = "day" | "week" | "month";

type Ctx = {
  /** The "anchor" date — week/day view derives its window from this. */
  focusDate: Date;
  setFocusDate: (d: Date) => void;
  view: CalendarView;
  setView: (v: CalendarView) => void;
  /** Source ids the user has hidden via sidebar checkboxes. */
  hiddenSources: Set<string>;
  toggleSource: (id: string) => void;
  /** Team-availability overlay: user ids the user wants overlaid. */
  overlayUsers: Set<string>;
  toggleOverlayUser: (id: string) => void;
};

const CalendarPrefsContext = createContext<Ctx | null>(null);

/**
 * Holds the calendar's *view* state — what's pinned, what's hidden, what's
 * overlaid. Everything in here is ephemeral and client-only: no server
 * round-trip when the user toggles a calendar's visibility, no URL bloat,
 * no persistence across hard refresh (a fresh state is a fine fresh start).
 */
export function CalendarPrefsProvider({ children }: { children: ReactNode }) {
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("week");
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(
    () => new Set(),
  );
  const [overlayUsers, setOverlayUsers] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleSource = useCallback((id: string) => {
    setHiddenSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleOverlayUser = useCallback((id: string) => {
    setOverlayUsers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      focusDate,
      setFocusDate,
      view,
      setView,
      hiddenSources,
      toggleSource,
      overlayUsers,
      toggleOverlayUser,
    }),
    [
      focusDate,
      view,
      hiddenSources,
      toggleSource,
      overlayUsers,
      toggleOverlayUser,
    ],
  );

  return (
    <CalendarPrefsContext.Provider value={value}>
      {children}
    </CalendarPrefsContext.Provider>
  );
}

export function useCalendarPrefs() {
  const ctx = useContext(CalendarPrefsContext);
  if (!ctx) {
    throw new Error(
      "useCalendarPrefs must be used inside <CalendarPrefsProvider>",
    );
  }
  return ctx;
}
