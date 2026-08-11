import { useSyncExternalStore } from "react";

/**
 * Local midnight, as a timestamp that updates when the day rolls over.
 *
 * Due-date buckets ("overdue", "today", "this week") depend on the clock, but
 * calling `Date.now()` during render is impure — it makes a `useMemo`
 * nondeterministic and the React Compiler rejects it. `useSyncExternalStore`
 * is the sanctioned way to read a mutable external source: `getSnapshot`
 * returns a stable number for the whole day, so re-renders are only triggered
 * when the answer actually changes.
 */
function dayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function subscribe(onChange: () => void) {
  // A minute is far finer than needed for a day boundary, and cheap; it also
  // means a phone left open overnight re-buckets its overdue tasks.
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
}

export function useDayStart(): number {
  return useSyncExternalStore(subscribe, dayStart, dayStart);
}
