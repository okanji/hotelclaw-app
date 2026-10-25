import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  CALENDAR_VIEWS,
  dayDensity,
  dayKey,
  densityLevel,
  shiftFocusDate,
  viewRange,
  yearMonths,
} from "../view-range";

const d = (y: number, m: number, day: number, h = 0, min = 0) =>
  new Date(y, m - 1, day, h, min);

describe("viewRange", () => {
  it("year spans Jan 1 to the next Jan 1", () => {
    const { from, to } = viewRange("year", d(2026, 7, 15, 13));
    expect(from).toEqual(d(2026, 1, 1));
    expect(to).toEqual(d(2027, 1, 1));
  });

  it("month pads a week either side", () => {
    const { from, to } = viewRange("month", d(2026, 3, 10));
    expect(from).toEqual(d(2026, 2, 22));
    expect(to).toEqual(d(2026, 4, 8));
  });

  it("week is Monday-start", () => {
    const { from } = viewRange("week", d(2026, 10, 25)); // Sunday
    expect(from).toEqual(d(2026, 10, 19));
  });

  it("covers every view", () => {
    for (const v of CALENDAR_VIEWS) {
      const r = viewRange(v, d(2026, 5, 5));
      expect(r.to.getTime()).toBeGreaterThan(r.from.getTime());
    }
  });
});

describe("shiftFocusDate", () => {
  it("year steps keep the month and clamp Feb 29", () => {
    expect(shiftFocusDate("year", d(2028, 2, 29), 1)).toEqual(d(2029, 2, 28));
    expect(shiftFocusDate("year", d(2026, 7, 4), -1)).toEqual(d(2025, 7, 4));
  });

  it("month steps clamp the day instead of rolling over", () => {
    expect(shiftFocusDate("month", d(2026, 1, 31), 1)).toEqual(d(2026, 2, 28));
    expect(addMonthsClamped(d(2026, 3, 31), -1)).toEqual(d(2026, 2, 28));
  });

  it("day and week step by 1 and 7 days", () => {
    expect(shiftFocusDate("day", d(2026, 12, 31), 1)).toEqual(d(2027, 1, 1));
    expect(shiftFocusDate("week", d(2026, 1, 3), -1)).toEqual(d(2025, 12, 27));
  });
});

describe("yearMonths", () => {
  it("returns the 12 month starts", () => {
    const months = yearMonths(d(2026, 6, 15));
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual(d(2026, 1, 1));
    expect(months[11]).toEqual(d(2026, 12, 1));
  });
});

describe("dayDensity", () => {
  const range = viewRange("year", d(2026, 1, 1));
  const iso = (x: Date) => x.toISOString();

  it("counts each day an event touches", () => {
    const map = dayDensity(
      [
        { start: iso(d(2026, 3, 1, 9)), end: iso(d(2026, 3, 1, 10)) },
        { start: iso(d(2026, 3, 1, 14)), end: iso(d(2026, 3, 3, 9)) },
      ],
      range,
    );
    expect(map.get(dayKey(d(2026, 3, 1)))).toBe(2);
    expect(map.get(dayKey(d(2026, 3, 2)))).toBe(1);
    expect(map.get(dayKey(d(2026, 3, 3)))).toBe(1);
    expect(map.get(dayKey(d(2026, 3, 4)))).toBeUndefined();
  });

  it("an all-day event ending at midnight stays on its day", () => {
    const map = dayDensity(
      [{ start: iso(d(2026, 5, 5)), end: iso(d(2026, 5, 6)) }],
      range,
    );
    expect(map.get(dayKey(d(2026, 5, 5)))).toBe(1);
    expect(map.has(dayKey(d(2026, 5, 6)))).toBe(false);
  });

  it("clips to the range and tolerates zero-length events", () => {
    const map = dayDensity(
      [
        { start: iso(d(2025, 12, 31, 20)), end: iso(d(2026, 1, 1, 2)) },
        { start: iso(d(2027, 1, 1, 9)), end: iso(d(2027, 1, 1, 10)) },
        { start: iso(d(2026, 8, 8, 9)), end: iso(d(2026, 8, 8, 9)) },
      ],
      range,
    );
    expect(map.has(dayKey(d(2025, 12, 31)))).toBe(false);
    expect(map.get(dayKey(d(2026, 1, 1)))).toBe(1);
    expect(map.get(dayKey(d(2026, 8, 8)))).toBe(1);
    expect(map.size).toBe(2);
  });
});

describe("densityLevel", () => {
  it("buckets counts", () => {
    expect([0, 1, 2, 3, 5, 6, 20].map(densityLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3,
    ]);
  });
});
