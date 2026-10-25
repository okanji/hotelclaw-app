import { describe, expect, it } from "vitest";
import {
  addDays,
  cadenceStartOnOrBefore,
  diffDays,
  eachDay,
  localDate,
  weekdayOf,
} from "../dates";
import { currentCycleOf, cyclePhase, planNewCycles } from "../plan";
import {
  breakdown,
  capacity,
  pct,
  scopeStats,
  successPct,
  taskPoints,
} from "../scope";
import { buildBurnup, type HistoryEvent } from "../burnup";

describe("dates", () => {
  it("does day arithmetic across month + DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(diffDays("2026-10-23", "2026-11-05")).toBe(13);
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(eachDay("2026-11-02", "2026-11-01")).toEqual([]);
  });

  it("knows weekdays (0 = Sunday)", () => {
    expect(weekdayOf("2026-10-25")).toBe(0); // Sunday
    expect(weekdayOf("2026-10-26")).toBe(1);
  });

  it("aligns to the cadence's start weekday", () => {
    // Sunday 25 Oct → previous Monday is 19 Oct.
    expect(cadenceStartOnOrBefore("2026-10-25", 1)).toBe("2026-10-19");
    expect(cadenceStartOnOrBefore("2026-10-26", 1)).toBe("2026-10-26");
    expect(cadenceStartOnOrBefore("2026-10-25", 0)).toBe("2026-10-25");
  });

  it("resolves the local date in the property's timezone", () => {
    const instant = "2026-10-25T22:30:00Z";
    expect(localDate(instant, "UTC")).toBe("2026-10-25");
    expect(localDate(instant, "Africa/Nairobi")).toBe("2026-10-26"); // UTC+3
    expect(localDate(instant, "America/Los_Angeles")).toBe("2026-10-25");
    // A garbage zone falls back to UTC instead of throwing.
    expect(localDate(instant, "Not/AZone")).toBe("2026-10-25");
  });
});

describe("planNewCycles", () => {
  const weekly = { duration_weeks: 1, start_weekday: 1, upcoming_count: 2 };

  it("creates current + upcoming from nothing", () => {
    const plan = planNewCycles(weekly, [], "2026-10-25");
    expect(plan).toEqual([
      { number: 1, starts_on: "2026-10-19", ends_on: "2026-10-25" },
      { number: 2, starts_on: "2026-10-26", ends_on: "2026-11-01" },
      { number: 3, starts_on: "2026-11-02", ends_on: "2026-11-08" },
    ]);
  });

  it("is idempotent once materialised", () => {
    const first = planNewCycles(weekly, [], "2026-10-25");
    expect(planNewCycles(weekly, first, "2026-10-25")).toEqual([]);
  });

  it("tops up upcoming as time passes, numbering sequentially", () => {
    const first = planNewCycles(weekly, [], "2026-10-25");
    const next = planNewCycles(weekly, first, "2026-10-27");
    expect(next).toEqual([
      { number: 4, starts_on: "2026-11-09", ends_on: "2026-11-15" },
    ]);
  });

  it("resumes at today's window after a long gap without back-filling", () => {
    const old = [{ number: 7, starts_on: "2026-08-03", ends_on: "2026-08-09" }];
    const plan = planNewCycles(weekly, old, "2026-10-25");
    expect(plan[0]).toEqual({
      number: 8,
      starts_on: "2026-10-19",
      ends_on: "2026-10-25",
    });
    expect(plan).toHaveLength(3);
  });

  it("never overlaps the previous cycle", () => {
    // Last cycle ended Friday; cadence starts Mondays → today's aligned
    // window would start before it ended, so the next one starts the day after.
    const old = [{ number: 1, starts_on: "2026-10-17", ends_on: "2026-10-23" }];
    const plan = planNewCycles(weekly, old, "2026-10-25");
    expect(plan[0]!.starts_on).toBe("2026-10-24");
    expect(cyclePhase(plan[0]!, "2026-10-25")).toBe("current");
  });

  it("honours multi-week durations", () => {
    const plan = planNewCycles(
      { duration_weeks: 2, start_weekday: 1, upcoming_count: 1 },
      [],
      "2026-10-25",
    );
    expect(plan).toEqual([
      { number: 1, starts_on: "2026-10-19", ends_on: "2026-11-01" },
      { number: 2, starts_on: "2026-11-02", ends_on: "2026-11-15" },
    ]);
  });

  it("doesn't loop when today sits in a hand-made gap", () => {
    const cycles = [
      { number: 1, starts_on: "2026-10-01", ends_on: "2026-10-07" },
      { number: 2, starts_on: "2026-11-01", ends_on: "2026-11-07" },
    ];
    const plan = planNewCycles(weekly, cycles, "2026-10-20");
    // Only tops up upcoming (1 existing → needs 1 more), no current invented.
    expect(plan).toEqual([
      { number: 3, starts_on: "2026-11-08", ends_on: "2026-11-14" },
    ]);
  });

  it("classifies phases", () => {
    const cycles = planNewCycles(weekly, [], "2026-10-25");
    expect(currentCycleOf(cycles, "2026-10-25")?.number).toBe(1);
    expect(cyclePhase(cycles[0]!, "2026-10-26")).toBe("past");
    expect(cyclePhase(cycles[2]!, "2026-10-25")).toBe("upcoming");
  });
});

describe("scope math", () => {
  const tasks = [
    { status: "done" as const, estimate: 3 },
    { status: "in_progress" as const, estimate: null }, // counts as 1
    { status: "blocked" as const, estimate: 2 },
    { status: "todo" as const, estimate: 0 }, // explicit 0 stays 0
  ];

  it("sums points, unestimated = 1", () => {
    expect(taskPoints(null)).toBe(1);
    expect(taskPoints(0)).toBe(0);
    expect(scopeStats(tasks)).toEqual({
      scope: 6,
      started: 3,
      completed: 3,
      count: 4,
      startedCount: 2,
      completedCount: 1,
    });
  });

  it("computes success and safe percentages", () => {
    expect(successPct(scopeStats(tasks))).toBe(50);
    expect(pct(1, 0)).toBe(0);
    expect(pct(2, 3)).toBe(67);
  });

  it("measures capacity against the last three finished cycles", () => {
    expect(capacity(10, [])).toEqual({ average: null, pct: null });
    // Only the three most recent count.
    expect(capacity(12, [8, 10, 12, 100])).toEqual({ average: 10, pct: 120 });
    expect(capacity(5, [0])).toEqual({ average: 0, pct: null });
  });

  it("breaks down by multi-valued keys", () => {
    const rows = breakdown(
      [
        { status: "done" as const, estimate: 2, labels: ["a", "b"] },
        { status: "todo" as const, estimate: 2, labels: ["a"] },
        { status: "todo" as const, estimate: null, labels: [] },
      ],
      (t) => (t.labels.length ? t.labels : ["none"]),
    );
    expect(rows).toEqual([
      { key: "a", scope: 4, completed: 2, count: 2, pct: 50 },
      { key: "b", scope: 2, completed: 2, count: 1, pct: 100 },
      { key: "none", scope: 1, completed: 0, count: 1, pct: 0 },
    ]);
  });
});

describe("buildBurnup", () => {
  const ev = (
    id: string,
    verb: string,
    from: unknown,
    to: unknown,
    at: string,
  ): HistoryEvent => ({
    entity_id: id,
    verb,
    detail: { from, to },
    created_at: at,
  });

  it("replays history backwards into daily snapshots", () => {
    const result = buildBurnup({
      cycleId: "C",
      startsOn: "2026-10-19",
      endsOn: "2026-10-25",
      today: "2026-10-22",
      timeZone: "UTC",
      tasks: [
        { id: "a", status: "done", estimate: 3, cycle_id: "C" },
        { id: "b", status: "in_progress", estimate: 2, cycle_id: "C" },
        { id: "c", status: "todo", estimate: null, cycle_id: "C" },
      ],
      events: [
        // c joined the cycle on the 21st
        ev("c", "cycle_changed", null, "C", "2026-10-21T09:00:00Z"),
        // b started on the 20th
        ev("b", "status_changed", "todo", "in_progress", "2026-10-20T10:00:00Z"),
        // a started on the 20th and finished on the 22nd
        ev("a", "status_changed", "todo", "in_progress", "2026-10-20T11:00:00Z"),
        ev("a", "completed", "in_progress", "done", "2026-10-22T08:00:00Z"),
        // a was re-estimated 1 → 3 on the 21st
        ev("a", "estimate_changed", 1, 3, "2026-10-21T12:00:00Z"),
      ],
    });
    const byDay = Object.fromEntries(result.points.map((p) => [p.date, p]));
    expect(byDay["2026-10-19"]).toMatchObject({ scope: 3, started: 0, completed: 0 });
    expect(byDay["2026-10-20"]).toMatchObject({ scope: 3, started: 3, completed: 0 });
    expect(byDay["2026-10-21"]).toMatchObject({ scope: 6, started: 5, completed: 0 });
    expect(byDay["2026-10-22"]).toMatchObject({ scope: 6, started: 2, completed: 3 });
    // Future days are unmeasured.
    expect(byDay["2026-10-23"]).toMatchObject({ scope: null });
    expect(result.points).toHaveLength(7);
    expect(result.stats.scope).toBe(6);
  });

  it("keeps rolled-over work in a finished cycle's final scope", () => {
    const result = buildBurnup({
      cycleId: "OLD",
      startsOn: "2026-10-12",
      endsOn: "2026-10-18",
      today: "2026-10-25",
      timeZone: "UTC",
      tasks: [
        { id: "done", status: "done", estimate: 2, cycle_id: "OLD" },
        // rolled to NEW when the page loaded on the 20th
        { id: "open", status: "todo", estimate: 2, cycle_id: "NEW" },
        // created after the cycle ended, never part of it
        { id: "later", status: "todo", estimate: 5, cycle_id: "NEW" },
      ],
      events: [
        ev("open", "cycle_changed", "OLD", "NEW", "2026-10-20T07:00:00Z"),
        {
          entity_id: "later",
          verb: "created",
          detail: {},
          created_at: "2026-10-21T07:00:00Z",
        },
      ],
    });
    expect(result.stats).toMatchObject({ scope: 4, completed: 2 });
    expect(successPct(result.stats)).toBe(50);
    expect([...result.members.keys()].sort()).toEqual(["done", "open"]);
  });

  it("buckets events by the property's local day", () => {
    // 22:30Z on the 19th is already the 20th in Nairobi.
    const result = buildBurnup({
      cycleId: "C",
      startsOn: "2026-10-19",
      endsOn: "2026-10-20",
      today: "2026-10-20",
      timeZone: "Africa/Nairobi",
      tasks: [{ id: "a", status: "done", estimate: 1, cycle_id: "C" }],
      events: [ev("a", "completed", "todo", "done", "2026-10-19T22:30:00Z")],
    });
    expect(result.points.map((p) => p.completed)).toEqual([0, 1]);
  });

  it("returns an unmeasured series for a cycle that hasn't started", () => {
    const result = buildBurnup({
      cycleId: "C",
      startsOn: "2026-11-02",
      endsOn: "2026-11-08",
      today: "2026-10-25",
      tasks: [{ id: "a", status: "todo", estimate: 2, cycle_id: "C" }],
      events: [],
    });
    expect(result.points.every((p) => p.scope === null)).toBe(true);
    expect(result.stats.scope).toBe(2);
  });
});
