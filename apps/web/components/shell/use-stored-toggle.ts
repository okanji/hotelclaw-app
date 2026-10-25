"use client";

import { useEffect, useState } from "react";

/** Persisted open/closed flag — read after mount so SSR can't mismatch. */
export function useStoredToggle(key: string, initial = false) {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored !== null) setOpen(stored === "1");
    } catch {
      // Storage unavailable — keep the default.
    }
  }, [key]);
  function toggle() {
    setOpen((o) => {
      try {
        window.localStorage.setItem(key, o ? "0" : "1");
      } catch {
        // Preference only.
      }
      return !o;
    });
  }
  return [open, toggle] as const;
}
