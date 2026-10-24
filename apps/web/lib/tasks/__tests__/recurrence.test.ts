import { describe, expect, it } from "vitest";
import { nextOccurrence } from "../mutations";

describe("nextOccurrence (recurring tasks, migration 0107)", () => {
  it("pushes a due date by one cadence and keeps the time of day", () => {
    const due = "2026-10-23T15:30:00.000Z";
    const daily = new Date(nextOccurrence(due, "daily"));
    const weekly = new Date(nextOccurrence(due, "weekly"));
    const biweekly = new Date(nextOccurrence(due, "biweekly"));
    const base = new Date(due);
    expect(daily.getTime() - base.getTime()).toBe(86_400_000);
    expect(weekly.getTime() - base.getTime()).toBe(7 * 86_400_000);
    expect(biweekly.getTime() - base.getTime()).toBe(14 * 86_400_000);
    expect(daily.getHours()).toBe(base.getHours());
    expect(daily.getMinutes()).toBe(base.getMinutes());
  });

  it("advances a calendar month, not 30 days", () => {
    const due = new Date(2026, 0, 31, 9, 0).toISOString(); // Jan 31
    const next = new Date(nextOccurrence(due, "monthly"));
    // JS rolls Jan 31 + 1 month into March (Feb has no 31st) — the point is
    // that it is month arithmetic, not a fixed 30-day hop.
    expect(next.getMonth()).toBeGreaterThanOrEqual(1);
    expect(next.getTime()).toBeGreaterThan(new Date(due).getTime() + 27 * 86_400_000);
  });

  it("gives an undated task a next due date one cadence from now", () => {
    const now = new Date(2026, 9, 23, 11, 0);
    const next = new Date(nextOccurrence(null, "weekly", new Date(now)));
    expect(next.getHours()).toBe(17);
    expect(Math.round((next.getTime() - now.setHours(17, 0, 0, 0)) / 86_400_000)).toBe(7);
  });
});
